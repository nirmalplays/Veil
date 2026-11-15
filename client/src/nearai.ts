// Thin client for NEAR AI Cloud (OpenAI-compatible, runs models in Intel TDX + NVIDIA GPU TEEs).
// Endpoint paths follow NEAR AI Cloud docs; re-check against docs.near.ai before relying on them.
import { checkModelAttestation, e2eeDecrypt, e2eeEncryptKeep, generateClientKeys, type KeyCheck } from "./e2ee.js";
import { toHex } from "./crypto.js";
import type { FullVerification } from "./verify.js";

export const BASE_URL = "https://cloud-api.near.ai/v1";

export interface ModelInfo { id: string; owned_by?: string; is_ready?: boolean; context_length?: number; supported_features?: string[]; architecture?: { outputModalities?: string[] }; pricing?: { input?: number; output?: number } }
/**
 * Chat models that run in NEAR AI's attested TEEs. Checked against the live API: models owned by "nearai" answer /attestation/report, while the
 * proxied third-party ones return "no provider supports attestation". Classifier, speech, reranker and embedding models are also "nearai" and
 * text-in, but declare no chat features, so a model must advertise tools, reasoning or structured output. Uncensored "abliterated" variants are left out of the default list.
 */
export const teeChatModels = (all: ModelInfo[]): ModelInfo[] =>
  all.filter((m) => m.owned_by === "nearai" && m.is_ready !== false && !/abliterated/i.test(m.id)
    && (m.architecture?.outputModalities ?? ["text"]).includes("text") && (m.supported_features?.length ?? 0) > 0);

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
/** Exact bytes exchanged, plus the secrets that let the sender later reveal what they said. Keep private unless disclosing. */
export interface Wire {
  requestBody: string; responseBody: string; ephemeralSecrets: string[]; clientSecret: string;
  /** Positions in the request of messages we forwarded but did not encrypt ourselves (a sealed knowledge base). Their ephemeral secret is "" because we never held it. */
  sealed?: number[];
}
export interface ChatResult { id: string; text: string; raw: unknown }

export class NearAI {
  constructor(private apiKey: string, private baseUrl = BASE_URL, private f: typeof fetch = (...a) => fetch(...a)) {}

  /**
   * A relay can charge per question: it answers 402 with where and how much to pay. If set, this is asked to pay and return the payment
   * header ("<tx hash>:<account>"); the request is then retried once with it. Return null to give up.
   */
  onPaymentRequired?: (payment: any) => Promise<string | null>;

  private async reqRaw(path: string, init: RequestInit = {}): Promise<string> {
    const go = (extra: Record<string, string> = {}) => this.f(this.baseUrl + path, {
      ...init,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}), ...extra },
    });
    let r = await go();
    if (r.status === 402 && this.onPaymentRequired) {
      const j = await r.json().catch(() => ({} as any));
      const header = await this.onPaymentRequired(j.payment ?? j);
      if (!header) throw new Error(`payment required: ${j.error ?? "no payment made"}`);
      r = await go({ "X-Veil-Payment": header });
    }
    if (!r.ok) throw new Error(`NEAR AI ${path} -> ${r.status} ${await r.text()}`);
    return r.text();
  }
  private async req(path: string, init: RequestInit = {}) {
    return JSON.parse(await this.reqRaw(path, init)) as any;
  }

  async chat(model: string, messages: ChatMessage[]): Promise<ChatResult> {
    const j = await this.req("/chat/completions", { method: "POST", body: JSON.stringify({ model, messages }) });
    return { id: j.id, text: j.choices?.[0]?.message?.content ?? "", raw: j };
  }

  /**
   * E2EE chat (v2): fetch attestation with a fresh nonce, check the key binding, pin the model key,
   * encrypt message contents to it, and decrypt the reply with an ephemeral client key. Non-streaming.
   * Throws if the attestation checks fail. Returns the check result so the UI can show it.
   */
  async chatE2EE(model: string, messages: ChatMessage[], opts: {
    maxTokens?: number;
    /** Full verifier (see verify.ts). Without it only the cheap key-to-quote binding is checked. */
    verify?: (report: unknown, nonce: string) => Promise<FullVerification>;
    /**
     * Returns a ready-made ciphertext (hex) for the verified enclave key, which is sent as a system message at `sealedAt` (default 1).
     * It is a knowledge base sealed by the site's relay: this client never reads it, and only the enclave can.
     */
    sealed?: (modelKey: string) => Promise<string>; sealedAt?: number;
  } = {}): Promise<ChatResult & { attestation: { nonce: string; report: unknown; check: KeyCheck; full?: FullVerification }; wire: Wire }> {
    const { nonce, report } = await this.attestation(model);
    let check = checkModelAttestation(report, nonce);
    let full: FullVerification | undefined;
    if (opts.verify) {
      full = await opts.verify(report, nonce);
      if (!full.ok || !full.publicKey) throw new Error(`attestation verification failed: ${full.checks.filter((c) => c.state === "failed").map((c) => c.label).join("; ")}`);
      check = { ...check, ok: true, publicKey: full.publicKey };
    }
    if (!check.ok || !check.publicKey) throw new Error(`attestation check failed: ${check.reasons.join(", ")}`);
    const client = generateClientKeys();
    const sealed: { role: string; data: string; ephemeralSecret: string }[] = messages.map((m) => ({ role: m.role, ...e2eeEncryptKeep(m.content, check.publicKey!) }));
    const sealedIdx: number[] = [];
    if (opts.sealed) {
      const at = Math.max(0, Math.min(opts.sealedAt ?? 1, sealed.length));
      sealed.splice(at, 0, { role: "system", data: await opts.sealed(check.publicKey), ephemeralSecret: "" }); sealedIdx.push(at);
    }
    const requestBody = JSON.stringify({
      model, stream: false, ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      messages: sealed.map((m) => ({ role: m.role, content: m.data })),
    });
    const responseBody = await this.reqRaw("/chat/completions", {
      method: "POST",
      headers: {
        "X-Signing-Algo": "ed25519", "X-Client-Pub-Key": client.pubHex, "X-Model-Pub-Key": check.publicKey,
        "X-Encryption-Version": "2", "x-no-aliasing": "true",
      },
      body: requestBody,
    });
    const j = JSON.parse(responseBody);
    const c = j.choices?.[0]?.message?.content;
    const wire: Wire = { requestBody, responseBody, ephemeralSecrets: sealed.map((m) => m.ephemeralSecret), clientSecret: toHex(client.x25519Secret), ...(sealedIdx.length ? { sealed: sealedIdx } : {}) };
    return { id: j.id, text: c ? e2eeDecrypt(c, client.x25519Secret) : "", raw: j, attestation: { nonce, report, check, full }, wire };
  }

  /** Fresh nonce so the report can't be replayed. */
  static nonce(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");
  }

  attestation(model: string, nonce = NearAI.nonce(), signingAlgo: "ecdsa" | "ed25519" = "ed25519") {
    const q = new URLSearchParams({ model, nonce, signing_algo: signingAlgo, provider: "near", include_tls_fingerprint: "false" });
    return this.req(`/attestation/report?${q}`).then((report) => ({ nonce, report }));
  }

  /** Signature over a completed response, made by the key bound to the attested enclave. */
  /** The signature may not be there the instant a reply arrives, or the lookup can land on another node, so it is retried briefly. */
  async signature(chatId: string, model: string, signingAlgo: "ecdsa" | "ed25519" = "ed25519", tries = 3) {
    const q = new URLSearchParams({ model, signing_algo: signingAlgo });
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try { return await this.req(`/signature/${encodeURIComponent(chatId)}?${q}`); }
      catch (e) { last = e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
    }
    throw last;
  }

  /**
   * Embeddings with the input encrypted to the model's attested key (the same protocol as chat). The enclave embeds the text and returns each
   * vector encrypted to an ephemeral key of ours, so neither the gateway nor anything on the path sees the text or the vector.
   * `modelKey` must come from an attestation that was verified.
   */
  async embedE2EE(model: string, texts: string[], modelKey: string): Promise<number[][]> {
    const client = generateClientKeys();
    const raw = await this.reqRaw("/embeddings", {
      method: "POST",
      headers: { "X-Signing-Algo": "ed25519", "X-Client-Pub-Key": client.pubHex, "X-Model-Pub-Key": modelKey, "X-Encryption-Version": "2", "x-no-aliasing": "true" },
      body: JSON.stringify({ model, input: texts.map((t) => e2eeEncryptKeep(t, modelKey).data) }),
    });
    const rows: { index: number; embedding: string }[] = [...(JSON.parse(raw).data ?? [])].sort((a, b) => a.index - b.index);
    if (rows.length !== texts.length) throw new Error(`embeddings: asked for ${texts.length}, got ${rows.length}`);
    return rows.map((r) => JSON.parse(e2eeDecrypt(r.embedding, client.x25519Secret)) as number[]);
  }

  /** The models endpoint. Only models owned by "nearai" run in the attested TEEs; third-party ones are proxied and have no attestation. */
  models() { return this.req("/models").then((j: any) => (j.data ?? []) as ModelInfo[]); }
}

/** sha256 hex of any JSON-serialisable report; this is what `record_eval`/`record_round` anchor on-chain. */
export async function attestationHash(report: unknown): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(report)));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}
