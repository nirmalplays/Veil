// Thin client for NEAR AI Cloud (OpenAI-compatible, runs models in Intel TDX + NVIDIA GPU TEEs).
// Endpoint paths follow NEAR AI Cloud docs; re-check against docs.near.ai before relying on them.
import { checkModelAttestation, e2eeDecrypt, e2eeEncryptKeep, generateClientKeys, type KeyCheck } from "./e2ee.js";
import { toHex } from "./crypto.js";
import type { FullVerification } from "./verify.js";

export const BASE_URL = "https://cloud-api.near.ai/v1";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
/** Exact bytes exchanged, plus the secrets that let the sender later reveal what they said. Keep private unless disclosing. */
export interface Wire { requestBody: string; responseBody: string; ephemeralSecrets: string[]; clientSecret: string }
export interface ChatResult { id: string; text: string; raw: unknown }

export class NearAI {
  constructor(private apiKey: string, private baseUrl = BASE_URL, private f: typeof fetch = (...a) => fetch(...a)) {}

  private async reqRaw(path: string, init: RequestInit = {}): Promise<string> {
    const r = await this.f(this.baseUrl + path, {
      ...init,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
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
  async chatE2EE(model: string, messages: ChatMessage[], opts: { maxTokens?: number; /** Full verifier (see verify.ts). Without it only the cheap key-to-quote binding is checked. */ verify?: (report: unknown, nonce: string) => Promise<FullVerification> } = {}): Promise<ChatResult & { attestation: { nonce: string; report: unknown; check: KeyCheck; full?: FullVerification }; wire: Wire }> {
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
    const sealed = messages.map((m) => ({ ...m, ...e2eeEncryptKeep(m.content, check.publicKey!) }));
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
    const wire: Wire = { requestBody, responseBody, ephemeralSecrets: sealed.map((m) => m.ephemeralSecret), clientSecret: toHex(client.x25519Secret) };
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
  signature(chatId: string, model: string, signingAlgo: "ecdsa" | "ed25519" = "ed25519") {
    const q = new URLSearchParams({ model, signing_algo: signingAlgo });
    return this.req(`/signature/${encodeURIComponent(chatId)}?${q}`);
  }
}

/** sha256 hex of any JSON-serialisable report; this is what `record_eval`/`record_round` anchor on-chain. */
export async function attestationHash(report: unknown): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(report)));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}
