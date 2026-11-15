// The whole Veil pipeline for one message, step by step, emitting a log event for each thing that happens.
// Runs in the browser (live page) and in Node (scripts/record.ts makes the recorded run). It uses Veil's real client code:
// nothing here is simulated. Each event names who did it, which parties the data passed through, and who could see it.
import { NearAI, type ChatMessage } from "../../client/src/nearai.js";
import { e2eeDecrypt, e2eeEncryptKeep, generateClientKeys } from "../../client/src/e2ee.js";
import { toHex } from "../../client/src/crypto.js";
import { checkRules, policyHash, type Policy } from "../../client/src/policy.js";
import { makeReceipt, redact, verifyReceipt, type Receipt } from "../../client/src/receipt.js";
import { verifyModelAttestation, verifyRelayAttestation, type Check } from "../../client/src/verify.js";

import type { FlowEvent, NodeId, StageId } from "./flow-meta.js";
export * from "./flow-meta.js";

export interface FlowOptions {
  relay: string; question: string; emit: (e: FlowEvent) => void;
  f?: typeof fetch; rpcs?: string[];
  /** Called while waiting on a slow step, so the UI can show a ticking timer. */ onWait?: (label: string | null) => void;
  /** Called when the relay asks for payment (free questions used up). Returns the payment header, or null to stop. */ pay?: (payment: any) => Promise<string | null>;
}
export interface FlowResult { ok: boolean; answer?: string; receipt?: Receipt; error?: string }

const short = (h: string, n = 24) => (h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-8)}` : h);
const kb = (n: number) => (n > 1500 ? `${(n / 1024).toFixed(1)} KB` : `${n} bytes`);

async function registered(contract: string, siteId: string, rpcs: string[], f: typeof fetch) {
  let last: unknown;
  for (const url of rpcs) {
    try {
      const r = await f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "veil", method: "query",
        params: { request_type: "call_function", finality: "final", account_id: contract, method_name: "get_policy", args_base64: btoa(JSON.stringify({ site_id: siteId })) } }) });
      const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error.data ?? j.error));
      return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) as { version: number; policy_hash: string; recorded_ms: number } | null;
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("no NEAR RPC answered");
}

/** Which party a verification check talked to, for the diagram and the log. */
function checkActor(c: Check): { actor: NodeId; path?: NodeId[] } {
  if (c.id === "nvidia") return { actor: "nvidia", path: ["you", "relay", "nvidia"] };
  if (c.id.startsWith("gw-")) return { actor: "gateway" };
  if (c.id === "intel" || c.id === "debug") return { actor: "intel", path: ["you", "intel"] };
  return { actor: "enclave" };
}

export async function runFlow(o: FlowOptions): Promise<FlowResult> {
  const f = o.f ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const rpcs = o.rpcs ?? ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];
  const relay = o.relay.replace(/\/$/, "");
  const t0 = Date.now();
  const emit = (e: Omit<FlowEvent, "t">) => o.emit({ t: Date.now() - t0, ...e });
  const wait = async <T>(label: string, p: Promise<T>) => { o.onWait?.(label); try { return await p; } finally { o.onWait?.(null); } };
  let stage: StageId = "wake";
  try {
    // 1. Reach the relay.
    emit({ kind: "step", stage, actor: "you", path: ["you", "relay"], text: "GET /config", detail: "The first request. Free hosting puts the relay to sleep when idle, so this can take up to a minute while it wakes." });
    const s0 = Date.now();
    const cr = await wait("Waking the relay", f(`${relay}/config`));
    if (!cr.ok) throw new Error(`the relay answered ${cr.status} to /config`);
    const site = await cr.json() as { siteId: string; title: string; model: string; contract: string; policy: Policy };
    const took = Date.now() - s0;
    emit({ kind: "ok", stage, actor: "relay", path: ["relay", "you"], text: `Relay answered in ${(took / 1000).toFixed(1)} s: site "${site.title}"`,
      detail: took > 8000 ? "That was a cold start: the free relay had been asleep." : "The relay was awake.", data: JSON.stringify({ siteId: site.siteId, model: site.model, contract: site.contract, rules: site.policy.rules?.length ?? 0 }, null, 2), visibleTo: ["you", "relay"] });

    // 2. Rules on NEAR.
    stage = "policy";
    const hash = policyHash(site.policy);
    emit({ kind: "data", stage, actor: "you", text: "Fingerprinted the site's rules in this browser (SHA-256)", data: hash, detail: "The master prompt and every checkable rule, in canonical form, hashed here. Change one character and this changes.", visibleTo: ["you", "relay", "near"] });
    emit({ kind: "step", stage, actor: "you", path: ["you", "near"], text: `get_policy("${site.siteId}") on ${site.contract}`, detail: "A read-only call to the Veil contract on NEAR testnet." });
    const reg = await wait("Asking NEAR", registered(site.contract, site.siteId, rpcs, f));
    if (!reg) { emit({ kind: "fail", stage, actor: "near", path: ["near", "you"], text: "This site has no policy registered on NEAR", detail: "The widget switches itself off in this case." }); return { ok: false, error: "policy not registered" }; }
    const match = reg.policy_hash.toLowerCase() === hash;
    emit({ kind: match ? "ok" : "fail", stage, actor: "near", path: ["near", "you"],
      text: match ? `Matches the registered policy (version ${reg.version}, recorded ${new Date(reg.recorded_ms).toISOString().slice(0, 10)})` : "The served rules do not match the registered ones",
      data: `registered ${reg.policy_hash}\nserved     ${hash}`, detail: match ? "The relay is serving exactly the rules the owner published, so it cannot quietly change them." : "The widget refuses to run when this happens.", visibleTo: ["you", "relay", "near"] });
    if (!match) return { ok: false, error: "policy mismatch" };

    // 3. Relay TEE.
    stage = "relay-tee";
    const rn = NearAI.nonce();
    emit({ kind: "step", stage, actor: "you", path: ["you", "relay"], text: "GET /relay-attestation with a fresh nonce", data: rn });
    const ra = await f(`${relay}/relay-attestation?nonce=${rn}`);
    if (ra.status === 501) {
      emit({ kind: "warn", stage, actor: "relay", path: ["relay", "you"], text: "The relay is not in a TEE (it runs on ordinary hosting)",
        detail: "Whoever runs the relay's server could read the site's NEAR AI API key. They still cannot read your messages: those are encrypted to the model's enclave, and the relay never holds a key that opens them." });
    } else if (ra.ok) {
      for (const c of await wait("Verifying the relay", verifyRelayAttestation(await ra.json(), rn)))
        emit({ kind: c.state === "ok" ? "ok" : c.state === "failed" ? "fail" : "info", stage, actor: "relay", text: c.label, detail: c.detail });
    } else emit({ kind: "warn", stage, actor: "relay", text: `The relay answered ${ra.status} when asked for proof` });

    // 4. Attestation.
    stage = "attest";
    const ai = new NearAI("", `${relay}/v1`, f);
    const nonce = NearAI.nonce();
    emit({ kind: "data", stage, actor: "you", text: "Generated a fresh 32-byte nonce, so an old proof cannot be replayed", data: nonce, visibleTo: ["you", "relay", "gateway", "enclave"] });
    emit({ kind: "step", stage, actor: "you", path: ["you", "relay", "gateway", "enclave"], text: `GET /v1/attestation/report for ${site.model}` });
    const { report } = await wait("Fetching the attestation", ai.attestation(site.model, nonce)) as { report: any };
    const cands = report?.model_attestations ?? [];
    emit({ kind: "ok", stage, actor: "enclave", path: ["enclave", "gateway", "relay", "you"], text: `Attestation received: ${cands.length} enclave candidate(s), ${kb(JSON.stringify(report).length)}`,
      detail: "It holds an Intel TDX quote, the enclave's boot event log, its docker compose, NVIDIA GPU evidence, and the gateway's own attestation.",
      data: JSON.stringify({ signing_algo: cands[0]?.signing_algo, signing_public_key: cands[0]?.signing_public_key, request_nonce: cands[0]?.request_nonce, intel_quote: short(cands[0]?.intel_quote ?? "", 32), gpu_evidence: !!cands[0]?.nvidia_payload, gateway: !!report?.gateway_attestation }, null, 2), visibleTo: ["you", "relay", "gateway", "enclave"] });

    // 5. Verify.
    stage = "verify";
    emit({ kind: "step", stage, actor: "you", path: ["you", "intel"], text: "Verifying the quote with Intel, and the GPUs with NVIDIA", detail: "This is the slow part: certificate chains and collateral are fetched and checked in this browser." });
    const full = await wait("Verifying Intel and NVIDIA evidence", verifyModelAttestation(report, nonce, { f, nrasProxy: `${relay}/nras` }));
    for (const c of full.checks) {
      const a = checkActor(c);
      emit({ kind: c.state === "ok" ? "ok" : c.state === "failed" ? "fail" : "info", stage, actor: a.actor, path: a.path, text: c.label, detail: c.detail });
    }
    if (!full.ok || !full.publicKey) {
      emit({ kind: "fail", stage, actor: "you", text: "Verification failed, so no key was pinned and nothing was sent" });
      return { ok: false, error: "attestation failed" };
    }
    emit({ kind: "ok", stage, actor: "you", text: `Pinned the enclave key${full.tcbStatus ? ` (Intel TCB ${full.tcbStatus})` : ""}`, data: full.publicKey, detail: "Only this key will be used to encrypt. It is proven to live inside the verified hardware.", visibleTo: ["you", "relay", "gateway", "enclave"] });

    // 6. Encrypt.
    stage = "encrypt";
    const client = generateClientKeys();
    emit({ kind: "data", stage, actor: "you", text: "Made a one-time key pair for the answer (Ed25519 → X25519)", data: `public: ${client.pubHex}\nprivate: stays in this tab`, visibleTo: ["you"] });
    const messages: ChatMessage[] = [{ role: "system", content: site.policy.prompt }, { role: "user", content: o.question }];
    const sealed = messages.map((m) => ({ role: m.role, ...e2eeEncryptKeep(m.content, full.publicKey!) }));
    emit({ kind: "data", stage, actor: "you", text: `Encrypted your message: ${new TextEncoder().encode(o.question).length} bytes in, ${sealed[1].data.length / 2} bytes of ciphertext out`,
      detail: "X25519 key agreement with the enclave key, HKDF-SHA256, then XChaCha20-Poly1305. The site's prompt is encrypted the same way.", data: `plaintext:  ${o.question}\nciphertext: ${short(sealed[1].data, 40)}`, visibleTo: ["you"] });

    // 7. Send.
    stage = "send";
    const requestBody = JSON.stringify({ model: site.model, stream: false, max_tokens: 400, messages: sealed.map((m) => ({ role: m.role, content: m.data })) });
    emit({ kind: "step", stage, actor: "you", path: ["you", "relay", "gateway", "enclave"], text: `POST /v1/chat/completions (${kb(requestBody.length)})`,
      detail: "This is everything the relay, its host and the network receive: the model name and ciphertext. The relay adds the API key and passes the bytes on unchanged.",
      data: short(requestBody, 140), visibleTo: ["you", "relay", "gateway", "enclave"] });
    const s7 = Date.now();
    const chatHeaders: Record<string, string> = { "Content-Type": "application/json", "X-Signing-Algo": "ed25519", "X-Client-Pub-Key": client.pubHex, "X-Model-Pub-Key": full.publicKey, "X-Encryption-Version": "2", "x-no-aliasing": "true" };
    let resp = await wait("The enclave is answering", f(`${relay}/v1/chat/completions`, { method: "POST", body: requestBody, headers: chatHeaders }));
    if (resp.status === 402) {
      // the site charges per question once the free ones are used: pay in NEAR from the visitor's wallet, then send again
      const pj = await resp.json().catch(() => ({} as any)), info = pj.payment ?? {};
      emit({ kind: "warn", stage, actor: "relay", path: ["relay", "you"], text: `Free questions used up: this site charges ${info.priceNear ?? "?"} NEAR per question`, detail: `Payments go to ${info.payTo} on NEAR ${info.network}. The relay checks the transfer on NEAR itself before it forwards anything.` });
      const header = o.pay ? await wait("Waiting for your wallet", o.pay(info)) : null;
      if (!header) throw new Error("payment required, and no payment was made");
      const [txh, who] = header.split(":");
      emit({ kind: "ok", stage, actor: "near", path: ["you", "near"], text: `Paid ${info.priceNear} NEAR from ${who}`, data: `transaction ${txh}\nto ${info.payTo}`, visibleTo: ["you", "relay", "near"] });
      resp = await wait("The enclave is answering", f(`${relay}/v1/chat/completions`, { method: "POST", body: requestBody, headers: { ...chatHeaders, "X-Veil-Payment": header } }));
    }
    const responseBody = await resp.text();
    if (!resp.ok) throw new Error(`the relay answered ${resp.status}: ${responseBody.slice(0, 160)}`);
    const j = JSON.parse(responseBody);
    const enc: string = j.choices?.[0]?.message?.content ?? "";
    emit({ kind: "ok", stage, actor: "enclave", path: ["enclave", "gateway", "relay", "you"], text: `Encrypted answer back in ${((Date.now() - s7) / 1000).toFixed(1)} s (${kb(responseBody.length)})`,
      data: `id: ${j.id}\ncontent: ${short(enc, 40)}`, detail: "The enclave encrypted its answer to the one-time key. The relay forwarded ciphertext again.", visibleTo: ["you", "relay", "gateway", "enclave"] });

    // 8. Decrypt.
    stage = "decrypt";
    const answer = e2eeDecrypt(enc, client.x25519Secret);
    emit({ kind: "ok", stage, actor: "you", text: "Decrypted the answer in this browser", data: answer, visibleTo: ["you", "enclave"] });

    // 9. Rules.
    stage = "rules";
    const results = checkRules(site.policy.rules, answer);
    for (const r of results) emit({ kind: r.ok ? "ok" : "warn", stage, actor: "you", text: r.label, detail: r.detail });
    const broke = results.filter((r) => !r.ok);
    if (broke.length) emit({ kind: "warn", stage, actor: "you", text: "The widget would hide this answer and show the site's fallback", detail: "The receipt still proves what the model said, so a broken rule cannot be hidden." });
    else if (results.length) emit({ kind: "ok", stage, actor: "you", text: `All ${results.length} rules hold, so the widget would show this answer` });

    // 10. Receipt.
    stage = "receipt";
    emit({ kind: "step", stage, actor: "you", path: ["you", "relay", "gateway"], text: `GET /v1/signature/${j.id}`, detail: "The enclave signs SHA-256 hashes of the exact request and response bytes." });
    const wire = { requestBody, responseBody, ephemeralSecrets: sealed.map((m) => m.ephemeralSecret), clientSecret: toHex(client.x25519Secret) };
    const receipt = await wait("Fetching the enclave's signature", makeReceipt(ai, site.model, { id: j.id, wire, attestation: { nonce, report } }, { policy: site.policy, disclose: { messages, reply: answer } }));
    emit({ kind: "data", stage, actor: "gateway", path: ["gateway", "relay", "you"], text: `Signature received (${receipt.signature.signing_algo}, ${receipt.signature.signature_kind ?? "provider_tee"})`, data: receipt.signature.text, visibleTo: ["you", "relay", "gateway"] });
    const v = await verifyReceipt(receipt, { policy: site.policy, policyHash: reg.policy_hash });
    for (const c of v.checks) emit({ kind: c.ok ? "ok" : "fail", stage, actor: "you", text: c.label, detail: c.detail });
    emit({ kind: v.ok ? "ok" : "fail", stage, actor: "you", text: v.ok ? "Receipt verified: this answer came from the attested enclave, under the registered rules" : "The receipt did not verify" });
    return { ok: v.ok, answer, receipt: redact(receipt) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit({ kind: "fail", stage, actor: "you", text: `Stopped: ${msg}`, detail: "Nothing after this point was sent." });
    return { ok: false, error: msg };
  }
}
