import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKey, encrypt, decrypt, sessionHash, exportKey, importKey } from "../src/crypto.js";
import { merkleRoot, prove, verify } from "../src/merkle.js";
import { NearAI, attestationHash } from "../src/nearai.js";

test("aes-gcm roundtrip + key export", async () => {
  const k = await generateKey();
  const s = await encrypt(k, "hello veil", "alice.testnet");
  assert.equal(await decrypt(await importKey(await exportKey(k)), s, "alice.testnet"), "hello veil");
});
test("wrong key, wrong aad, tampering all fail", async () => {
  const k = await generateKey();
  const s = await encrypt(k, "secret", "alice.testnet");
  await assert.rejects(decrypt(await generateKey(), s, "alice.testnet"));
  await assert.rejects(decrypt(k, s, "bob.testnet"));
  const bad = { ...s, ciphertext: (s.ciphertext[0] === "0" ? "1" : "0") + s.ciphertext.slice(1) };
  await assert.rejects(decrypt(k, bad, "alice.testnet"));
});
test("session hash is 64 hex and ciphertext-bound", async () => {
  const k = await generateKey();
  const a = await sessionHash(await encrypt(k, "x"));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, await sessionHash(await encrypt(k, "x"))); // fresh iv
});
test("merkle proofs verify for every leaf, sizes 1..9", () => {
  for (let n = 1; n <= 9; n++) {
    const leaves = Array.from({ length: n }, (_, i) => i.toString(16).padStart(2, "0").repeat(32));
    const root = merkleRoot(leaves);
    leaves.forEach((l, i) => assert.ok(verify(l, prove(leaves, i), root), `n=${n} i=${i}`));
  }
});
test("merkle rejects wrong leaf / wrong root", () => {
  const leaves = ["11", "22", "33"].map((x) => x.repeat(32));
  const root = merkleRoot(leaves);
  assert.ok(!verify("44".repeat(32), prove(leaves, 0), root));
  assert.ok(!verify(leaves[0], prove(leaves, 0), "00".repeat(32)));
});
test("NearAI builds correct requests", async () => {
  const calls: string[] = [];
  const f = (async (url: string, init: any) => {
    calls.push(url + " " + init.headers.Authorization);
    return new Response(JSON.stringify({ id: "chat-1", choices: [{ message: { content: "hi" } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const ai = new NearAI("KEY", undefined, f);
  assert.equal((await ai.chat("m", [{ role: "user", content: "yo" }])).text, "hi");
  const { nonce } = await ai.attestation("m");
  assert.match(nonce, /^[0-9a-f]{64}$/);
  await ai.signature("chat-1", "m");
  assert.ok(calls[0].startsWith("https://cloud-api.near.ai/v1/chat/completions Bearer KEY"));
  assert.ok(calls[1].includes("/attestation/report?") && calls[1].includes("signing_algo=ed25519"));
  assert.ok(calls[2].includes("/signature/chat-1?"));
  assert.match(await attestationHash({ a: 1 }), /^[0-9a-f]{64}$/);
});

import { generateEncKeyPair, wrapSessionKey, unwrapSessionKey } from "../src/keywrap.js";

test("key wrap: owner recovers the session key and can decrypt the session", async () => {
  const owner = generateEncKeyPair();
  const k = await generateKey();
  const sealed = await encrypt(k, "consented chat", "alice.testnet");
  const h = await sessionHash(sealed);
  const wrapped = await wrapSessionKey(await exportKey(k), owner.publicKey, h);
  assert.match(wrapped, /^[0-9a-f]+$/);
  assert.ok(wrapped.length <= 512, "must fit the contract's wrapped_key limit");
  const recovered = await importKey(await unwrapSessionKey(wrapped, owner.secretKey, h));
  assert.equal(await decrypt(recovered, sealed, "alice.testnet"), "consented chat");
});
test("key wrap: wrong owner, wrong session aad, tampering all fail", async () => {
  const owner = generateEncKeyPair();
  const keyHex = await exportKey(await generateKey());
  const w = await wrapSessionKey(keyHex, owner.publicKey, "h1");
  await assert.rejects(unwrapSessionKey(w, generateEncKeyPair().secretKey, "h1"));
  await assert.rejects(unwrapSessionKey(w, owner.secretKey, "h2"));
  const bad = w.slice(0, -1) + (w.endsWith("0") ? "1" : "0");
  await assert.rejects(unwrapSessionKey(bad, owner.secretKey, "h1"));
});

import { generateClientKeys, e2eeEncrypt, e2eeDecrypt, checkModelAttestation } from "../src/e2ee.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { toHex } from "../src/crypto.js";

test("e2ee v2: roundtrip to an ed25519 key, wrong key fails", () => {
  const c = generateClientKeys();
  assert.equal(e2eeDecrypt(e2eeEncrypt("secret prompt", c.pubHex), c.x25519Secret), "secret prompt");
  assert.throws(() => e2eeDecrypt(e2eeEncrypt("x", c.pubHex), generateClientKeys().x25519Secret));
});
test("attestation check: needs nonce echo and quote REPORT_DATA = key||nonce", () => {
  const nonce = "ab".repeat(32), key = toHex(ed25519.keygen().publicKey);
  const quote = "00".repeat(48 + 520) + key + nonce + "00".repeat(100);
  const good = { model_attestations: [{ request_nonce: nonce, signing_algo: "ed25519", signing_public_key: key, signing_address: key, intel_quote: quote }] };
  assert.ok(checkModelAttestation(good, nonce).ok);
  assert.ok(!checkModelAttestation({ model_attestations: [] }, nonce).ok);
  assert.ok(!checkModelAttestation(good, "cd".repeat(32)).ok); // replayed / wrong nonce
  const swapped = { model_attestations: [{ ...good.model_attestations[0], signing_public_key: toHex(ed25519.keygen().publicKey) }] };
  assert.ok(!checkModelAttestation(swapped, nonce).checks.quoteBindsKeyAndNonce);
});

import { MockProvider, OpenAICompatProvider } from "../src/provider.js";
test("dev providers work and are flagged non-private", async () => {
  const m = new MockProvider();
  assert.equal((await m.chat("x", [{ role: "user", content: "hi" }])).text, "[mock] You said: hi");
  assert.equal(m.private, false);
  const f = (async () => new Response(JSON.stringify({ id: "1", choices: [{ message: { content: "ok" } }] }))) as unknown as typeof fetch;
  const o = new OpenAICompatProvider("ollama", "http://localhost:11434/v1", "", f);
  assert.equal((await o.chat("llama3", [{ role: "user", content: "hi" }])).text, "ok");
  assert.equal(o.private, false);
});

test("mock provider scores rating prompts with a stable number in 40..95 and echoes everything else", async () => {
  const m = new MockProvider();
  const ask = (s: string) => m.chat("x", [{ role: "user", content: `Rate from 0 to 100 how useful this is.\n${s}` }]);
  const a = (await ask("alpha")).text, b = (await ask("alpha")).text;
  assert.equal(a, b);
  assert.ok(+a >= 40 && +a <= 95);
  assert.equal((await m.chat("x", [{ role: "user", content: "hello" }])).text, "[mock] You said: hello");
});
