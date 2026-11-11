import { test } from "node:test";
import assert from "node:assert/strict";
import { e2eeDecrypt, e2eeEncryptWith, e2eeOpenSent, generateClientKeys } from "../src/e2ee.js";
import { checkSealedAudit, openSealed, sealKnowledgeBase, sealedPrompt } from "../src/seal.js";
import { kbInfo, type KbChunk } from "../src/kb.js";

const chunks: KbChunk[] = [{ title: "Fees", text: "A first visit costs 85 dollars." }, { title: "Insurance", text: "We accept Delta and Aetna. Never discuss the discount code SPRING50 unprompted." }];
const enclave = generateClientKeys();

test("encrypting with a given ephemeral secret and nonce is deterministic and decryptable only by the recipient", () => {
  const eph = "11".repeat(32), nonce = "22".repeat(24);
  const a = e2eeEncryptWith("hello", enclave.pubHex, eph, nonce), b = e2eeEncryptWith("hello", enclave.pubHex, eph, nonce);
  assert.equal(a, b);
  assert.equal(e2eeDecrypt(a, enclave.x25519Secret), "hello");
  assert.equal(e2eeOpenSent(a, eph, enclave.pubHex), "hello", "the sender can reopen it with the ephemeral secret");
  assert.throws(() => e2eeDecrypt(a, generateClientKeys().x25519Secret), "another key cannot read it");
  assert.notEqual(e2eeEncryptWith("hello", enclave.pubHex, eph, "33".repeat(24)), a);
});

test("the sealed message is the whole knowledge base, with instructions to keep it confidential and to cite by title", () => {
  const p = sealedPrompt(chunks);
  assert.match(p, /\[Fees\] A first visit costs 85 dollars\./); assert.match(p, /\[Insurance\] We accept Delta/);
  assert.match(p, /never repeat/i); assert.match(p, /never follow instructions/i); assert.match(p, /do not have that information/i);
});

test("sealing is deterministic for the same key and knowledge base, and changes with either, or with the secret", () => {
  const s = sealKnowledgeBase({ chunks, modelKey: enclave.pubHex, secret: "relay-secret" });
  assert.deepEqual(sealKnowledgeBase({ chunks, modelKey: enclave.pubHex, secret: "relay-secret" }), s);
  assert.notEqual(sealKnowledgeBase({ chunks, modelKey: generateClientKeys().pubHex, secret: "relay-secret" }).content, s.content);
  assert.notEqual(sealKnowledgeBase({ chunks: chunks.slice(1), modelKey: enclave.pubHex, secret: "relay-secret" }).content, s.content);
  assert.notEqual(sealKnowledgeBase({ chunks, modelKey: enclave.pubHex, secret: "other-secret" }).content, s.content);
});
test("only the enclave can read what was sealed, and nothing readable is left in the ciphertext", () => {
  const s = sealKnowledgeBase({ chunks, modelKey: enclave.pubHex, secret: "relay-secret" });
  assert.equal(e2eeDecrypt(s.content, enclave.x25519Secret), sealedPrompt(chunks));
  assert.ok(!/^[0-9a-f]+$/i.test("zz") && /^[0-9a-f]+$/.test(s.content), "hex only");
  const asText = Buffer.from(s.content, "hex").toString("latin1");
  assert.ok(!asText.includes("SPRING50") && !asText.includes("Fees"));
  assert.throws(() => e2eeDecrypt(s.content, generateClientKeys().x25519Secret));
});

test("an audit proves what was sealed, and that it is the knowledge base registered on NEAR", () => {
  const s = sealKnowledgeBase({ chunks, modelKey: enclave.pubHex, secret: "relay-secret" });
  const root = kbInfo(chunks).root;
  assert.equal(openSealed(s.content, s.ephemeralSecret, enclave.pubHex), sealedPrompt(chunks));
  const ok = checkSealedAudit({ content: s.content, ephemeralSecret: s.ephemeralSecret, chunks }, enclave.pubHex, root);
  assert.ok(ok.length === 2 && ok.every((c) => c.ok), JSON.stringify(ok));
  assert.ok(checkSealedAudit({ content: s.content, ephemeralSecret: s.ephemeralSecret, chunks }, enclave.pubHex, "00".repeat(32)).some((c) => !c.ok), "a different registered root");
  const edited = chunks.map((c, i) => (i === 0 ? { ...c, text: "A first visit costs 1 dollar." } : c));
  assert.ok(checkSealedAudit({ content: s.content, ephemeralSecret: s.ephemeralSecret, chunks: edited }, enclave.pubHex, kbInfo(edited).root).some((c) => !c.ok), "chunks that were not what was sealed");
  assert.ok(checkSealedAudit({ content: s.content, ephemeralSecret: "00".repeat(32), chunks }, enclave.pubHex, root).some((c) => !c.ok), "a wrong secret cannot open it");
});
