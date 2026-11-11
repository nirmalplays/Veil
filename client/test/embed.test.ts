import { test } from "node:test";
import assert from "node:assert/strict";
import { NearAI } from "../src/nearai.js";
import { Embedder } from "../src/embed.js";
import { e2eeDecrypt, e2eeEncrypt, generateClientKeys } from "../src/e2ee.js";
import { EMBED_MODEL, kbSemantic, quantize } from "../src/kb.js";

/** A stand-in enclave. It holds a real key pair, so it can only read what was genuinely encrypted to that key, and it answers the way the real service does. */
function fakeEnclave(opts: { failFirstEmbed?: boolean; shuffle?: boolean } = {}) {
  const model = generateClientKeys();
  const seen: { body: string; headers: Record<string, string> }[] = []; let attestations = 0, embedCalls = 0;
  const vec = (t: string) => { const v = Array.from({ length: 16 }, (_, i) => (t.toLowerCase().includes(["cost", "open", "park", "weather"][i % 4]) && i < 4 ? 1 : 0.02)); return v; };
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/attestation/report")) { attestations++; return new Response(JSON.stringify({ model_attestations: [{ signing_public_key: model.pubHex }] })); }
    if (u.endsWith("/embeddings")) {
      embedCalls++; const body = String(init?.body); const headers = init?.headers as Record<string, string>; seen.push({ body, headers });
      if (opts.failFirstEmbed && embedCalls === 1) return new Response("stale key", { status: 400 });
      const j = JSON.parse(body); if (headers["X-Model-Pub-Key"] !== model.pubHex) return new Response("wrong key", { status: 400 });
      const texts: string[] = j.input.map((h: string) => e2eeDecrypt(h, model.x25519Secret));   // only possible with the real key
      const rows = texts.map((t, index) => ({ index, object: "embedding", embedding: e2eeEncrypt(JSON.stringify(vec(t)), headers["X-Client-Pub-Key"]) }));
      return new Response(JSON.stringify({ data: opts.shuffle ? rows.reverse() : rows }));
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, model, seen, get attestations() { return attestations; }, get embedCalls() { return embedCalls; } };
}
const verifier = (key: string) => async () => ({ ok: true, publicKey: key, checks: [] });
const ai = (f: typeof fetch) => new NearAI("k", "https://x.test/v1", f);

test("a question is embedded in the enclave and never travels in plaintext", async () => {
  const e = fakeEnclave(); const emb = new Embedder(ai(e.f), EMBED_MODEL, verifier(e.model.pubHex));
  const [v] = await emb.embed(["How much does a first visit cost?"]);
  assert.equal(v.length, 16); assert.equal(v[0], 1, "the enclave read the real text");
  assert.ok(!e.seen[0].body.includes("first visit") && !e.seen[0].body.includes("cost"), "the request body carries only ciphertext");
  assert.equal(e.seen[0].headers["X-Encryption-Version"], "2");
  assert.equal(e.seen[0].headers["X-Model-Pub-Key"], e.model.pubHex);
});
test("results come back in the order asked, even if the service reorders them, and large inputs are batched", async () => {
  const e = fakeEnclave({ shuffle: true }); const emb = new Embedder(ai(e.f), EMBED_MODEL, verifier(e.model.pubHex));
  const texts = Array.from({ length: 40 }, (_, i) => (i % 2 ? "opening times" : "price and cost"));
  const out = await emb.embed(texts, 16);
  assert.equal(out.length, 40); assert.equal(e.embedCalls, 3, "40 texts in batches of 16");
  assert.ok(out.every((v, i) => (i % 2 ? v[1] === 1 && v[0] === 0.02 : v[0] === 1 && v[1] === 0.02)), "each vector belongs to its own text");
});
test("the attested key is pinned: one attestation serves many questions", async () => {
  const e = fakeEnclave(); const emb = new Embedder(ai(e.f), EMBED_MODEL, verifier(e.model.pubHex));
  await emb.embed(["a"]); await emb.embed(["b"]); await emb.embed(["c"]);
  assert.equal(e.attestations, 1); assert.equal(e.embedCalls, 3);
});
test("if the key has rotated, it re-checks the attestation once and retries", async () => {
  const e = fakeEnclave({ failFirstEmbed: true }); const emb = new Embedder(ai(e.f), EMBED_MODEL, verifier(e.model.pubHex));
  const [v] = await emb.embed(["price and cost"]);
  assert.equal(v[0], 1); assert.equal(e.attestations, 2);
});
test("an attestation that fails verification means nothing is sent", async () => {
  const e = fakeEnclave(); const bad = new Embedder(ai(e.f), EMBED_MODEL, async () => ({ ok: false, checks: [{ id: "intel", state: "failed" as const, label: "Intel confirms the quote", detail: "x" }] }));
  await assert.rejects(bad.embed(["secret question"]), /attestation failed/);
  assert.equal(e.embedCalls, 0, "no request was made with an unverified key");
});
test("end to end with the knowledge base: the embedded question finds the right passage", async () => {
  const e = fakeEnclave(); const emb = new Embedder(ai(e.f), EMBED_MODEL, verifier(e.model.pubHex));
  const passages = ["what it will cost", "when we are open", "where to park"]; const vecs = await emb.embed(passages);
  const chunks = passages.map((text, i) => ({ title: "t" + i, text, vec: quantize(vecs[i]) }));
  const [q] = await emb.embed(["How much does it cost?"]);
  assert.equal(chunks[kbSemantic(q, chunks, 1, 0.1)[0].index].text, "what it will cost");
});
