import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { blobPath, handle, nep413Hash, RECIPIENT, type Deps } from "../../supabase/functions/_shared/gate.ts";
import { merkleRoot } from "../src/merkle.js";

// ---- fakes: an in-memory chain and storage ----
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58e = (b: Uint8Array) => { let n = 0n; for (const x of b) n = n * 256n + BigInt(x); let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const x of b) { if (x === 0) s = "1" + s; else break; } return s; };
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const NOW = Date.parse("2026-11-04T12:00:00.000Z");
const H1 = "ab".repeat(32), H2 = "cd".repeat(32);

function world() {
  const t = { now: NOW };
  const chain = {
    keys: new Set<string>(), sessions: {} as Record<string, any>, models: {} as Record<string, any>, consent: new Set<string>(),
    async view(m: string, a: any) {
      if (m === "get_session") return chain.sessions[a.session_hash] ?? null;
      if (m === "get_model") return chain.models[a.model_id] ?? null;
      if (m === "has_consent") return chain.consent.has(`${a.session_hash}|${a.model_id}`);
      throw new Error("unexpected " + m);
    },
    async hasAccessKey(acct: string, pk: string) { return chain.keys.has(`${acct}|${pk}`); },
  };
  const objs = new Map<string, string>(); const nrasCalls: string[] = [];
  const storage = {
    async put(b: string, p: string, body: string) { objs.set(`${b}/${p}`, body); },
    async signedDownloadUrl(b: string, p: string) { return objs.has(`${b}/${p}`) ? `https://s.test/dl/${b}/${p}` : null; },
    async remove(b: string, p: string) { objs.delete(`${b}/${p}`); },
    async exists(b: string, p: string) { return objs.has(`${b}/${p}`); },
  };
  let n = 0;
  const w: { nrasCalls: string[] } = { nrasCalls };
  const deps: Deps = { secret: "test-secret", now: () => t.now, verify: (pk, m, s) => ed25519.verify(s, m, pk), chain, storage, newId: () => `id${String(++n).padStart(8, "0")}`, nras: async (body: string) => { w.nrasCalls.push(body); return new Response(JSON.stringify([["JWT", "a.b.c"], {}]), { status: 200 }); } };
  return { t, chain, objs, deps, nrasCalls };
}
const post = (w: ReturnType<typeof world>, route: string, body: unknown, token?: string) =>
  handle(new Request(`https://x.test/functions/v1/blob-gate/${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }), w.deps);

/** Signs a login for a fresh key registered as an access key of `account`. */
async function login(w: ReturnType<typeof world>, account: string, o: { ts?: number; recipient?: string; register?: boolean } = {}) {
  const kp = ed25519.keygen(); const pk = `ed25519:${b58e(kp.publicKey)}`;
  if (o.register !== false) w.chain.keys.add(`${account}|${pk}`);
  const message = `veil-blob-gate login ${new Date(o.ts ?? w.t.now).toISOString()}`, nonce = crypto.getRandomValues(new Uint8Array(32));
  const sig = ed25519.sign(await nep413Hash(message, nonce, o.recipient ?? RECIPIENT), kp.secretKey);
  return post(w, "auth", { accountId: account, publicKey: pk, signature: b64(sig), message, nonce: hex(nonce) });
}
const token = async (w: ReturnType<typeof world>, account: string) => (await (await login(w, account)).json()).token as string;

test("auth accepts a signature made by near-api-js (verifier parity)", async () => {
  const w = world(); const v = { accountId: "vec.testnet", publicKey: "ed25519:DQpwDQNGJsJNTAJaMnmmB3ptYqdNeZ7cSJJX1m2pY9aQ", signature: "p0mj13iH2VMQ9WVA8bvJTvVrYwwiPA66vQtzeRuMt1vB+fOO5Whu6UMzMlQwhSskvsjHHMOqf9GbgRv8EJp6DQ==", message: "veil-blob-gate login 2026-11-04T12:00:00.000Z", nonce: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20" };
  w.chain.keys.add(`${v.accountId}|${v.publicKey}`);
  const r = await post(w, "auth", v); assert.equal(r.status, 200); assert.ok((await r.json()).token.startsWith("vec.testnet."));
});
test("auth rejects a bad signature, a stale message, the wrong recipient, an unregistered key and a non-ed25519 key", async () => {
  const w = world();
  assert.equal((await login(w, "alice.testnet", { ts: NOW - 10 * 60_000 })).status, 401);
  assert.equal((await login(w, "alice.testnet", { recipient: "somewhere-else" })).status, 401);
  assert.equal((await login(w, "alice.testnet", { register: false })).status, 401);
  const kp = ed25519.keygen(); const message = `veil-blob-gate login ${new Date(NOW).toISOString()}`, nonce = new Uint8Array(32);
  const sig = ed25519.sign(await nep413Hash(message, nonce, RECIPIENT), kp.secretKey); sig[0] ^= 1;
  const pk = `ed25519:${b58e(kp.publicKey)}`; w.chain.keys.add(`alice.testnet|${pk}`);
  assert.equal((await post(w, "auth", { accountId: "alice.testnet", publicKey: pk, signature: b64(sig), message, nonce: hex(nonce) })).status, 401);
  assert.equal((await post(w, "auth", { accountId: "alice.testnet", publicKey: "secp256k1:abc", signature: "AA", message, nonce: hex(nonce) })).status, 401);
});
test("every action needs a valid, unexpired, untampered token", async () => {
  const w = world(); const t = await token(w, "alice.testnet");
  assert.equal((await post(w, "upload", { data: "{}" })).status, 401);
  assert.equal((await post(w, "upload", { data: "{}" }, t.slice(0, -2) + "xx")).status, 401);
  assert.equal((await post(w, "upload", { data: "{}" }, t.replace("alice", "bobby"))).status, 401); // account swapped, mac no longer matches
  assert.equal((await post(w, "upload", { data: "{}" }, t)).status, 200);
  w.t.now += 2 * 3600_000; assert.equal((await post(w, "upload", { data: "{}" }, t)).status, 401);
});
test("upload stores the ciphertext under the caller's own prefix and refuses empty or oversized bodies", async () => {
  const w = world(); const data = JSON.stringify({ iv: "00", ciphertext: "ff" });
  const a = await (await post(w, "upload", { data }, await token(w, "alice.testnet"))).json(), b = await (await post(w, "upload", { data }, await token(w, "bob.testnet"))).json();
  assert.match(a.blob_id, /^sb:alice\.testnet\/id/); assert.match(b.blob_id, /^sb:bob\.testnet\/id/); assert.notEqual(a.blob_id, b.blob_id);
  assert.equal(w.objs.get(`blobs/${blobPath(a.blob_id)}`), data);
  const t = await token(w, "alice.testnet");
  assert.equal((await post(w, "upload", {}, t)).status, 400);
  assert.equal((await post(w, "upload", { data: "x".repeat(5_000_001) }, t)).status, 400);
});

function committed(w: ReturnType<typeof world>) {
  const blob_id = "sb:alice.testnet/id00000099";
  w.objs.set("blobs/alice.testnet/id00000099", "ciphertext");
  w.chain.sessions[H1] = { owner: "alice.testnet", blob_id, forgotten: false };
  w.chain.models["m1"] = { owner: "owner.testnet" };
  return blob_id;
}
test("download: the session owner reads their own blob, a stranger cannot", async () => {
  const w = world(); const blob_id = committed(w);
  assert.equal((await post(w, "download", { blob_id }, await token(w, "alice.testnet"))).status, 200);
  assert.equal((await post(w, "download", { blob_id }, await token(w, "mallory.testnet"))).status, 403);
  assert.equal((await post(w, "download", { blob_id, session_hash: H1, model_id: "m1" }, await token(w, "mallory.testnet"))).status, 403);
});
test("download: a model owner reads only while consent is live, and only as the real model owner", async () => {
  const w = world(); const blob_id = committed(w); const t = await token(w, "owner.testnet");
  const ask = () => post(w, "download", { blob_id, session_hash: H1, model_id: "m1" }, t);
  assert.equal((await ask()).status, 403, "no consent yet");
  w.chain.consent.add(`${H1}|m1`); assert.equal((await ask()).status, 200, "consent live");
  w.chain.consent.delete(`${H1}|m1`); assert.equal((await ask()).status, 403, "muted, expired or revoked");
  w.chain.consent.add(`${H1}|m1`); w.chain.sessions[H1].forgotten = true; assert.equal((await ask()).status, 403, "forgotten");
  w.chain.sessions[H1].forgotten = false; w.chain.models["m1"].owner = "someone.else"; assert.equal((await ask()).status, 403, "not the model's owner");
});
test("download: the blob must be the one the chain records for that session, and must exist", async () => {
  const w = world(); const blob_id = committed(w); w.chain.consent.add(`${H1}|m1`); const t = await token(w, "owner.testnet");
  assert.equal((await post(w, "download", { blob_id: "sb:alice.testnet/other00000001", session_hash: H1, model_id: "m1" }, t)).status, 403);
  w.objs.clear(); assert.equal((await post(w, "download", { blob_id, session_hash: H1, model_id: "m1" }, t)).status, 404);
  assert.equal((await post(w, "download", { blob_id: "not-a-blob" }, t)).status, 400);
});
test("delete: only your own blobs, and it really removes them", async () => {
  const w = world(); const blob_id = committed(w);
  assert.equal((await post(w, "delete", { blob_id }, await token(w, "mallory.testnet"))).status, 403);
  assert.ok(w.objs.has("blobs/alice.testnet/id00000099"));
  const r = await post(w, "delete", { blob_id }, await token(w, "alice.testnet"));
  assert.equal(r.status, 200); assert.equal((await r.json()).deleted, true); assert.equal(w.objs.size, 0);
});
test("manifest: accepted only when the root is the Merkle root of the leaves, for sizes 1..9 (parity with the client)", async () => {
  const w = world(); const t = await token(w, "owner.testnet");
  for (let n = 1; n <= 9; n++) {
    const leaves = Array.from({ length: n }, (_, i) => i.toString(16).padStart(2, "0").repeat(32));
    assert.equal((await post(w, "manifest", { root: merkleRoot(leaves), leaves }, t)).status, 200, `n=${n}`);
  }
  assert.equal((await post(w, "manifest", { root: "00".repeat(32), leaves: [H1, H2] }, t)).status, 400);
  assert.equal((await post(w, "manifest", { root: H1, leaves: ["nothex"] }, t)).status, 400);
  assert.equal((await post(w, "manifest", { root: merkleRoot([H1]), leaves: [H1] })).status, 401);
  const root = merkleRoot([H1, H2]); await post(w, "manifest", { root, leaves: [H1, H2] }, t);
  assert.deepEqual(JSON.parse(w.objs.get(`rounds/${root}.json`)!), { root, leaves: [H1, H2] });
});
test("blobPath accepts only sb:<account>/<id>", () => {
  assert.equal(blobPath("sb:alice.testnet/abcdefgh12"), "alice.testnet/abcdefgh12");
  for (const bad of ["", "alice/x", "sb:../etc/passwd", "sb:alice.testnet/../x", "sb:Alice/abcdefgh", "sb:alice.testnet/short", 5, null]) assert.equal(blobPath(bad as any), null);
});

const gpu = (w: ReturnType<typeof world>, body: unknown, path = "nras/v3/attest/gpu", method = "POST") =>
  handle(new Request(`https://x.test/functions/v1/blob-gate/${path}`, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }), w.deps);

test("nras forwarder: passes GPU evidence through untouched, with no sign-in, and returns NVIDIA's answer", async () => {
  const w = world(); const ev = { nonce: "ab".repeat(32), evidence_list: [{ evidence: "x" }], arch: "HOPPER" };
  const r = await gpu(w, ev);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), [["JWT", "a.b.c"], {}]);
  assert.equal(w.nrasCalls.length, 1); assert.deepEqual(JSON.parse(w.nrasCalls[0]), ev);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});
test("nras forwarder: refuses anything that is not GPU evidence, other paths, other methods and oversized bodies", async () => {
  const w = world();
  assert.equal((await gpu(w, "not json")).status, 400);
  assert.equal((await gpu(w, { nonce: 1, evidence_list: [] })).status, 400);
  assert.equal((await gpu(w, { nonce: "ab", evidence_list: "x" })).status, 400);
  assert.equal((await gpu(w, [1, 2])).status, 400);
  assert.equal((await gpu(w, { nonce: "ab", evidence_list: [] }, "nras/v3/attest/cpu")).status, 401, "other paths are not forwarded (they fall through to the token check)");
  assert.equal((await gpu(w, null, "nras/v3/attest/gpu", "GET")).status, 405);
  assert.equal((await gpu(w, { nonce: "ab", evidence_list: [], pad: "x".repeat(2_000_001) })).status, 413);
  assert.equal(w.nrasCalls.length, 0, "nothing was forwarded");
});
