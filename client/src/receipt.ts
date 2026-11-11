// Verifiable answer receipts. A receipt proves that a specific (encrypted) request and reply passed through
// an attested NEAR AI enclave: the enclave signs sha256(request body) and sha256(response body) with the same
// ed25519 key that its TDX quote binds. With `disclosure`, the holder also reveals the plaintext and policy.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { toHex, fromHex } from "./crypto.js";
import { checkModelAttestation, e2eeDecrypt, e2eeOpenSent } from "./e2ee.js";
import type { ChatMessage, NearAI, Wire } from "./nearai.js";
import type { FullVerification } from "./verify.js";
import { checkRules, policyHash, type Policy, type RuleResult } from "./policy.js";
import { checkKbEvidence, type KbChunk, type KbEvidence } from "./kb.js";
import { checkSealedAudit } from "./seal.js";

const te = new TextEncoder();
export const sha256Hex = (s: string) => toHex(sha256(te.encode(s)));

export interface Disclosure { messages: ChatMessage[]; reply: string; ephemeralSecrets: string[]; clientSecret: string; /** The full policy (prompt, rules and knowledge base fingerprint) whose hash the receipt names. */ policy?: Policy;
  /** Which registered knowledge-base chunks the answer was grounded on, with Merkle proofs. */ kb?: KbEvidence;
  /** Positions of messages in the signed request that are sealed: encrypted by the site's relay to the enclave, so their content is not disclosed here. */ sealed?: number[];
  /** Added by the site owner on request: what the sealed message held, so a third party can check it against the registered knowledge base. */ sealedAudit?: { content: string; ephemeralSecret: string; chunks: KbChunk[] } }
export interface Receipt {
  v: 1; id: string; model: string; createdAt: number;
  requestBody: string; responseBody: string;
  signature: { text: string; signature: string; signing_address: string; signing_algo: string; /** "provider_tee" (signed by the model's enclave) or "gateway" (signed by the gateway). Older captures omit it. */ signature_kind?: string };
  attestation: { nonce: string; report: unknown };
  /** Hash of the policy (master prompt and rules, see policy.ts) the answer ran under, if any. Checked only with disclosure. */
  policyHash?: string;
  disclosure?: Disclosure;
}

/** Fetches the enclave signature for a finished E2EE chat and packages everything a third party needs. */
export async function makeReceipt(
  ai: NearAI, model: string,
  chat: { id: string; wire: Wire; attestation: { nonce: string; report: unknown } },
  opts: { policy?: Policy; kb?: KbEvidence; disclose?: { messages: ChatMessage[]; reply: string } } = {},
): Promise<Receipt> {
  const signature = (await ai.signature(chat.id, model)) as Receipt["signature"];
  const r: Receipt = {
    v: 1, id: chat.id, model, createdAt: Date.now(),
    requestBody: chat.wire.requestBody, responseBody: chat.wire.responseBody, signature,
    attestation: { nonce: chat.attestation.nonce, report: chat.attestation.report },
    ...(opts.policy !== undefined ? { policyHash: policyHash(opts.policy) } : {}),
  };
  if (opts.disclose) r.disclosure = { ...opts.disclose, ephemeralSecrets: chat.wire.ephemeralSecrets, clientSecret: chat.wire.clientSecret, ...(opts.policy ? { policy: opts.policy } : {}), ...(opts.kb ? { kb: opts.kb } : {}), ...(chat.wire.sealed?.length ? { sealed: chat.wire.sealed } : {}) };
  return r;
}

/** A receipt without the secrets: safe to share when you only want to prove an exchange happened. */
export const redact = (r: Receipt): Receipt => { const { disclosure, ...rest } = r; return rest; };

export interface ReceiptCheck { label: string; ok: boolean; detail: string }
/** `ok` means the exchange is authentic. `compliance` is separate: an authentic answer can still have broken a rule. */
export interface Compliance {
  checked: boolean; ok: boolean; results: RuleResult[]; note?: string;
  /** True when the policy hash was compared with a registered one. Without that, the rules are only the ones the receipt's holder attached. */
  againstRegistry: boolean;
}
export interface ReceiptResult { ok: boolean; checks: ReceiptCheck[]; text?: string; messages?: ChatMessage[]; publicKey?: string; compliance: Compliance }

/**
 * Offline checks. Pass `verifyAttestation` (see verify.ts) to also verify the TDX quote and GPU evidence;
 * without it only the key-to-quote binding in the report is checked. `policy` is the registered policy text to compare.
 */
export async function verifyReceipt(
  r: Receipt,
  opts: { verifyAttestation?: (report: unknown, nonce: string) => Promise<FullVerification>; policy?: Policy; /** Hash taken from the on-chain registry. */ policyHash?: string } = {},
): Promise<ReceiptResult> {
  const checks: ReceiptCheck[] = [];
  const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });
  // Two formats exist: "provider_tee" signs model:requestHash:responseHash with the model's key; "gateway" signs requestHash:responseHash with the gateway's.
  const parts = r.signature.text.split(":");
  const kind = r.signature.signature_kind ?? (parts.length === 2 ? "gateway" : "provider_tee");
  const [model, reqH, resH] = kind === "gateway" ? [r.model, parts[0], parts[1]] : parts;
  if (kind === "gateway") add("Signature format", parts.length === 2, "gateway: requestHash:responseHash");
  else add("Signed model matches", model === r.model, `${model}`);
  add("Request body matches signed hash", sha256Hex(r.requestBody) === reqH, `sha256 ${reqH?.slice(0, 16)}…`);
  add("Response body matches signed hash", sha256Hex(r.responseBody) === resH, `sha256 ${resH?.slice(0, 16)}…`);
  let sigOk = false;
  try { sigOk = r.signature.signing_algo === "ed25519" && ed25519.verify(fromHex(r.signature.signature), te.encode(r.signature.text), fromHex(r.signature.signing_address)); } catch { /* invalid encoding */ }
  add("Enclave signature is valid", sigOk, `ed25519 by ${r.signature.signing_address.slice(0, 16)}…`);
  let bodyId: string | undefined; try { bodyId = JSON.parse(r.responseBody).id; } catch { /* not json */ }
  add("Receipt id matches response", bodyId === r.id, r.id);

  let key: string | undefined;
  if (opts.verifyAttestation) {
    const f = await opts.verifyAttestation(r.attestation.report, r.attestation.nonce);
    key = f.publicKey;
    add("Enclave attestation verified (TDX + GPU)", f.ok && !!f.publicKey, f.ok ? "all checks passed" : f.checks.filter((c) => c.state === "failed").map((c) => c.label).join("; "));
  } else {
    const k = checkModelAttestation(r.attestation.report, r.attestation.nonce);
    key = k.publicKey;
    add("Attested key bound to quote (no full verify)", k.ok, k.ok ? "report data matches" : k.reasons.join(", "));
  }
  // Which attested identity must have signed: the model's enclave key, or (for gateway signatures) the gateway's.
  const expected = kind === "gateway" ? (r.attestation.report as any)?.gateway_attestation?.signing_address : key;
  add(kind === "gateway" ? "Signing key is the attested gateway key" : "Signing key is the attested enclave key", !!expected && String(expected).toLowerCase() === r.signature.signing_address.toLowerCase(), expected ? `${String(expected).slice(0, 16)}…` : "no attested key");

  let text: string | undefined, messages: ChatMessage[] | undefined;
  const d = r.disclosure;
  if (d) {
    try {
      text = e2eeDecrypt(JSON.parse(r.responseBody).choices[0].message.content, fromHex(d.clientSecret));
      add("Disclosed reply decrypts from the signed response", text === d.reply, "reply matches");
    } catch (e) { add("Disclosed reply decrypts from the signed response", false, String(e)); }
    try {
      const sent = JSON.parse(r.requestBody).messages as { content: string }[];
      const sealedAt = new Set(d.sealed ?? []);   // messages the site's relay sealed to the enclave: present in the signed request, but this copy cannot open them
      const opened = sent.map((m, i) => (sealedAt.has(i) ? null : e2eeOpenSent(m.content, d.ephemeralSecrets[i], key ?? "")));
      add("Disclosed prompt matches the signed request", opened.length === d.messages.length && opened.every((t, i) => sealedAt.has(i) || t === d.messages[i].content), `${opened.length - sealedAt.size} messages opened`);
      if (sealedAt.size) add("Sealed knowledge base is part of the signed request", [...sealedAt].every((i) => i >= 0 && i < sent.length && /^[0-9a-f]+$/i.test(sent[i].content)), `${sealedAt.size} sealed message, content not disclosed in this copy`);
      if (d.sealedAudit) {
        const idx = [...sealedAt][0];
        add("The audited sealed message is the one in the signed request", idx !== undefined && sent[idx]?.content === d.sealedAudit.content, "ciphertexts are identical");
        for (const c of checkSealedAudit(d.sealedAudit, key ?? "", d.policy?.kb?.root)) add(c.label, c.ok, c.detail);
      }
      messages = d.messages;
      if (r.policyHash !== undefined && d.policy) {
        add("Disclosed policy matches the receipt's policy hash", policyHash(d.policy) === r.policyHash, `policy ${r.policyHash.slice(0, 16)}…`);
        add("Policy prompt was the system message that was sent", d.messages.some((m) => m.role === "system" && m.content === d.policy!.prompt), "system message equals the policy prompt");
      } else if (r.policyHash !== undefined) add("Disclosed policy matches the receipt's policy hash", false, "receipt names a policy hash but does not disclose the policy");
      if (d.kb) for (const c of checkKbEvidence(d.kb, d.policy?.kb?.root, d.messages)) add(c.label, c.ok, c.detail);
    } catch (e) { add("Disclosed prompt matches the signed request", false, String(e)); }
  }
  const want = opts.policyHash?.toLowerCase() ?? (opts.policy !== undefined ? policyHash(opts.policy) : undefined);
  if (want !== undefined) add("Policy equals the registered policy", r.policyHash === want, r.policyHash ? `${r.policyHash.slice(0, 16)}…` : "receipt has no policy hash");
  // Rules are checked on the reply the signed response really contains (decrypted above), never on a claimed copy.
  const policyOk = d?.policy ? checks.filter((c) => c.label.startsWith("Disclosed policy")).every((c) => c.ok) : false;
  let compliance: Compliance;
  if (d?.policy && policyOk && text !== undefined) {
    const results = checkRules(d.policy.rules, text);
    compliance = { checked: true, againstRegistry: want !== undefined && r.policyHash === want, ok: results.every((x) => x.ok), results, note: results.length ? undefined : "The policy has no mechanical rules; its prompt is not proven to have been obeyed." };
  } else compliance = { checked: false, againstRegistry: false, ok: false, results: [], note: d ? "Rules could not be checked: the receipt does not disclose a policy that matches its hash." : "Rules not checked: this copy does not disclose the content." };
  return { ok: checks.every((c) => c.ok), checks, text, messages, publicKey: key, compliance };
}
