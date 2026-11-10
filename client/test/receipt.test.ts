import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { redact, verifyReceipt, type Receipt } from "../src/receipt.js";
import { policyHash, type Policy } from "../src/policy.js";

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
