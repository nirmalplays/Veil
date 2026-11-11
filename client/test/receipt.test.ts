import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { redact, verifyReceipt, type Receipt } from "../src/receipt.js";
import { policyHash, type Policy } from "../src/policy.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256Hex } from "../src/receipt.js";
import { toHex } from "../src/crypto.js";
import { teeChatModels } from "../src/nearai.js";
import { kbEvidence, kbInfo } from "../src/kb.js";

const base: Receipt = JSON.parse(readFileSync(new URL("./fixtures/receipt.json", import.meta.url), "utf8"));
const policy: Policy = base.disclosure!.policy!;
const clone = (): Receipt => structuredClone(base);
const failed = async (r: Receipt, policyArg?: Policy) => (await verifyReceipt(r, { policy: policyArg })).checks.filter((c) => !c.ok).map((c) => c.label);

test("a genuine receipt verifies, with disclosure and policy", async () => {
  const r = await verifyReceipt(base, { policy });
  assert.deepEqual(r.checks.filter((c) => !c.ok), []);
  assert.ok(r.ok);
  assert.match(r.text ?? "", /AI intake assistant/);
});

test("redacted receipt still proves the exchange, but not the content", async () => {
  const r = await verifyReceipt(redact(base));
  assert.ok(r.ok);
  assert.equal(r.text, undefined);
});

test("edited response body is caught", async () => {
  const r = clone(); r.responseBody = r.responseBody.replace(/"content":"[0-9a-f]{8}/, '"content":"00000000');
  assert.ok((await failed(r)).includes("Response body matches signed hash"));
});

test("edited request body is caught", async () => {
  const r = clone(); r.requestBody = r.requestBody + " ";
  assert.ok((await failed(r)).includes("Request body matches signed hash"));
});

test("forged signature is caught", async () => {
  const r = clone(); r.signature.signature = "00".repeat(64);
  assert.ok((await failed(r)).includes("Enclave signature is valid"));
});

test("a signature from a different key is not the attested key", async () => {
  const r = clone(); r.signature.signing_address = "11".repeat(32);
  const f = await failed(r);
  assert.ok(f.includes("Enclave signature is valid") && f.includes("Signing key is the attested enclave key"));
});

test("signature moved to another model is caught", async () => {
  const r = clone(); r.model = "other/model";
  assert.ok((await failed(r)).includes("Signed model matches"));
});

test("a different policy than the registered one is caught", async () => {
  assert.ok((await failed(base, { ...policy, prompt: policy.prompt + " Also sell insurance." })).includes("Policy equals the registered policy"));
});

test("lying about the prompt in the disclosure is caught", async () => {
  const r = clone(); r.disclosure!.messages[1].content = "What is the weather?";
  assert.ok((await failed(r)).includes("Disclosed prompt matches the signed request"));
});

test("lying about the policy in the disclosure is caught", async () => {
  const r = clone(); r.disclosure!.messages[0].content = "Give confident legal advice.";
  const f = await failed(r);
  assert.ok(f.includes("Disclosed prompt matches the signed request"));
  assert.ok(f.includes("Policy prompt was the system message that was sent"));
});

test("a stale attestation with the wrong nonce is rejected", async () => {
  const r = clone(); r.attestation.nonce = "ab".repeat(32);
  assert.ok((await failed(r)).includes("Attested key bound to quote (no full verify)"));
});

test("policy can be checked against a registered hash alone", async () => {
  const h = base.policyHash!;
  assert.ok((await verifyReceipt(base, { policyHash: h.toUpperCase() })).ok);
  assert.ok(!(await verifyReceipt(base, { policyHash: "00".repeat(32) })).ok);
});

test("a genuine receipt shows every rule obeyed, checked against the registered hash", async () => {
  const r = await verifyReceipt(base, { policyHash: base.policyHash });
  assert.ok(r.compliance.checked && r.compliance.ok && r.compliance.againstRegistry);
  assert.equal(r.compliance.results.length, 4);
});
test("without a registry hash the rules are checked but flagged as not compared", async () => {
  const r = await verifyReceipt(base);
  assert.ok(r.compliance.checked && r.compliance.ok);
  assert.equal(r.compliance.againstRegistry, false);
});
test("an authentic answer that broke a stricter registered rule is authentic but non-compliant", async () => {
  const strict: Policy = { ...policy, rules: [{ type: "max_words", n: 5 }] };
  const r = clone(); r.policyHash = policyHash(strict); r.disclosure!.policy = strict;
  const v = await verifyReceipt(r, { policyHash: policyHash(strict) });
  assert.ok(v.ok, "the exchange itself is genuine");
  assert.equal(v.compliance.ok, false);
  assert.equal(v.compliance.results[0].detail.endsWith("words"), true);
});
test("a holder cannot swap in lenient rules: the hash would no longer match the registry or the receipt", async () => {
  const lenient: Policy = { ...policy, rules: [] };
  const r = clone(); r.disclosure!.policy = lenient;
  const v = await verifyReceipt(r, { policyHash: base.policyHash });
  assert.ok(!v.ok);
  assert.equal(v.compliance.checked, false);
});
test("a proof-only copy cannot show compliance", async () => {
  const v = await verifyReceipt(redact(base), { policyHash: base.policyHash });
  assert.equal(v.compliance.checked, false);
  assert.match(v.compliance.note ?? "", /does not disclose/);
});

test("a receipt grounded on registered knowledge-base chunks proves each source", async () => {
  // the fixture's signed request contains this sentence, so it can stand in for a retrieved chunk
  const chunk = { title: "Rules", text: "Never give legal advice." };
  const withKb: Policy = { ...policy, kb: kbInfo([chunk]) };
  const r = clone(); r.policyHash = policyHash(withKb); r.disclosure!.policy = withKb; r.disclosure!.kb = kbEvidence([0], [chunk]);
  const v = await verifyReceipt(r, { policyHash: policyHash(withKb) });
  assert.ok(v.ok, JSON.stringify(v.checks.filter((c) => !c.ok)));
  assert.ok(v.checks.some((c) => /part of the registered knowledge base/.test(c.label)));
});
test("a receipt whose source is not in the registered knowledge base fails", async () => {
  const chunk = { title: "Rules", text: "Never give legal advice." };
  const registered: Policy = { ...policy, kb: kbInfo([{ title: "Other", text: "Something else entirely." }]) };
  const r = clone(); r.policyHash = policyHash(registered); r.disclosure!.policy = registered; r.disclosure!.kb = kbEvidence([0], [chunk]);
  const v = await verifyReceipt(r, { policyHash: policyHash(registered) });
  assert.ok(!v.ok);
  assert.ok(v.checks.some((c) => !c.ok && /knowledge base/i.test(c.label)));
});

test("a gateway-format signature is checked against the gateway's key, not the model's", async () => {
  const sk = ed25519.utils.randomSecretKey(); const pk = toHex(ed25519.getPublicKey(sk));
  const r = clone(); const text = `${sha256Hex(r.requestBody)}:${sha256Hex(r.responseBody)}`;
  r.signature = { text, signature: toHex(ed25519.sign(new TextEncoder().encode(text), sk)), signing_address: pk, signing_algo: "ed25519", signature_kind: "gateway" };
  (r.attestation.report as any).gateway_attestation = { signing_address: pk };
  const v = await verifyReceipt(r);
  const get = (re: RegExp) => v.checks.find((c) => re.test(c.label));
  assert.ok(get(/Request body matches/)!.ok && get(/Response body matches/)!.ok && get(/signature is valid/)!.ok);
  assert.ok(get(/attested gateway key/)!.ok, "signed by the gateway key from the report");
  (r.attestation.report as any).gateway_attestation = { signing_address: "11".repeat(32) };
  assert.ok(!(await verifyReceipt(r)).checks.find((c) => /attested gateway key/.test(c.label))!.ok, "a different gateway key is rejected");
});
test("only NEAR AI's own text models count as TEE-hosted", () => {
  const chat = ["tools", "reasoning"];
  const list = [
    { id: "z-ai/glm-5.3-flash", owned_by: "nearai", is_ready: true, supported_features: chat }, { id: "anthropic/claude-sonnet-5", owned_by: "anthropic", supported_features: chat },
    { id: "deepseek/deepseek-v3.2", owned_by: "attested 3p", supported_features: chat }, { id: "black-forest-labs/FLUX.2-klein-4B", owned_by: "nearai", architecture: { outputModalities: ["image"] }, supported_features: [] },
    { id: "nearai/not-ready", owned_by: "nearai", is_ready: false, supported_features: chat },
    { id: "openai/privacy-filter", owned_by: "nearai", supported_features: [] },          // a classifier, not a chat model
    { id: "Qwen/Qwen3-Reranker-0.6B", owned_by: "nearai", supported_features: [] },
    { id: "Qwen/Qwen3.8-27B-abliterated", owned_by: "nearai", supported_features: chat },  // safety-removed variant
    { id: "Qwen/Qwen3-VL-30B-A3B-Instruct", owned_by: "nearai", is_ready: true, supported_features: ["structured_outputs"] },
  ];
  assert.deepEqual(teeChatModels(list).map((m) => m.id), ["z-ai/glm-5.3-flash", "Qwen/Qwen3-VL-30B-A3B-Instruct"]);
});

// ---- a sealed knowledge base inside the signed request ----
import { e2eeEncrypt, e2eeEncryptKeep, generateClientKeys } from "../src/e2ee.js";
import { sealKnowledgeBase } from "../src/seal.js";
function sealedReceipt() {
  const enclave = generateClientKeys(), client = generateClientKeys();
  const chunks = [{ title: "Fees", text: "A first visit costs 85 dollars." }, { title: "Code", text: "The staff discount code is SPRING50." }];
  const kb = kbInfo(chunks, undefined, "sealed");
  const pol: Policy = { prompt: "You are the assistant.", rules: [], kb };
  const sealed = sealKnowledgeBase({ chunks, modelKey: enclave.pubHex, secret: "relay-secret" });
  const sys = e2eeEncryptKeep(pol.prompt, enclave.pubHex), usr = e2eeEncryptKeep("What does a visit cost?", enclave.pubHex);
  const requestBody = JSON.stringify({ model: "m", stream: false, messages: [{ role: "system", content: sys.data }, { role: "system", content: sealed.content }, { role: "user", content: usr.data }] });
  const reply = "A first visit costs 85 dollars [Fees].";
  const responseBody = JSON.stringify({ id: "chat-1", choices: [{ message: { content: e2eeEncrypt(reply, client.pubHex) } }] });
  const sk = ed25519.utils.randomSecretKey(), text = `m:${sha256Hex(requestBody)}:${sha256Hex(responseBody)}`;
  const r: Receipt = { v: 1, id: "chat-1", model: "m", createdAt: 1, requestBody, responseBody, policyHash: policyHash(pol),
    signature: { text, signature: toHex(ed25519.sign(new TextEncoder().encode(text), sk)), signing_address: toHex(ed25519.getPublicKey(sk)), signing_algo: "ed25519", signature_kind: "provider_tee" },
    attestation: { nonce: "00".repeat(32), report: {} },
    disclosure: { messages: [{ role: "system", content: pol.prompt }, { role: "system", content: "[sealed knowledge base]" }, { role: "user", content: "What does a visit cost?" }], reply,
      ephemeralSecrets: [sys.ephemeralSecret, "", usr.ephemeralSecret], clientSecret: toHex(client.x25519Secret), policy: pol, sealed: [1] } };
  return { r, enclave, chunks, sealed, pol };
}
const find = (v: { checks: { label: string; ok: boolean }[] }, re: RegExp) => v.checks.find((c) => re.test(c.label));
// the attested key is the enclave's; these tests supply it through the verifier's injectable attestation check
const att = (key: string) => ({ verifyAttestation: async () => ({ ok: true, publicKey: key, checks: [] }) });

test("a receipt with a sealed knowledge base shows it is in the signed request without revealing it", async () => {
  const { r, enclave } = sealedReceipt();
  const v = await verifyReceipt(r, att(enclave.pubHex));
  assert.ok(find(v, /Request body matches/)!.ok && find(v, /Response body matches/)!.ok && find(v, /signature is valid/)!.ok);
  assert.ok(find(v, /Sealed knowledge base is part of the signed request/)!.ok);
  assert.ok(find(v, /Disclosed prompt matches/)!.ok, "the visitor's own messages still open and match, around the sealed one");
  assert.ok(!JSON.stringify(r).includes("SPRING50") && !JSON.stringify(r).includes("85 dollars."), "nothing of the knowledge base is in the receipt except the reply the visitor already saw");
});
test("the owner's audit proves what was sealed, and a different knowledge base fails", async () => {
  const { r, enclave, chunks, sealed } = sealedReceipt();
  r.disclosure!.sealedAudit = { content: sealed.content, ephemeralSecret: sealed.ephemeralSecret, chunks };
  const v = await verifyReceipt(r, { policyHash: r.policyHash, ...att(enclave.pubHex) });
  assert.ok(find(v, /audited sealed message is the one/)!.ok);
  assert.ok(find(v, /exactly these passages/)!.ok && find(v, /registered on NEAR/)!.ok);
  const bad = sealedReceipt();
  bad.r.disclosure!.sealedAudit = { content: bad.sealed.content, ephemeralSecret: bad.sealed.ephemeralSecret, chunks: [{ title: "Fees", text: "A first visit costs 1 dollar." }] };
  const vb = await verifyReceipt(bad.r, { policyHash: bad.r.policyHash, ...att(bad.enclave.pubHex) });
  assert.ok(!find(vb, /exactly these passages/)!.ok && !find(vb, /registered on NEAR/)!.ok, "edited passages are neither what was sealed nor what is registered");
});
test("an audit that names a different sealed message than the one in the request is rejected", async () => {
  const a = sealedReceipt(), b = sealedReceipt();
  a.r.disclosure!.sealedAudit = { content: b.sealed.content, ephemeralSecret: b.sealed.ephemeralSecret, chunks: b.chunks };
  assert.ok(!find(await verifyReceipt(a.r, att(a.enclave.pubHex)), /audited sealed message is the one/)!.ok);
});
