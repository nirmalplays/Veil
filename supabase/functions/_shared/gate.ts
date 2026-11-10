// Blob gate: the only way to reach the private "blobs" bucket. Runtime-agnostic (no Deno or Node APIs beyond fetch,
// WebCrypto and Request/Response), so the same code runs as a Supabase Edge Function and under the Node tests.
//
// Trust model. Supabase Storage holds ciphertext only. This gate decides who may upload, download and delete it,
// using NEAR as the source of truth instead of Supabase Auth:
//  - /auth      A NEP-413 signature proves control of a NEAR account (the key must be an access key of it, checked on-chain).
//               The gate answers with a one-hour HMAC token for that account.
//  - /upload    Stores a ciphertext blob (at most 5 MB) under the caller's own prefix and returns its blob_id.
//  - /download  The session's owner may read their own objects. A model owner may read a session only if the contract
//               says they own that model AND the session has live consent for it (so mute, expiry, revoke and forget all cut access).
//  - /delete    A caller may delete only objects under their own prefix.
//  - /nras/v3/attest/gpu  A fixed forwarder to NVIDIA's GPU attestation service (browsers cannot call it: it refuses CORS
//               preflights). Public, because attestation evidence is public. It forwards that one path only and adds nothing:
//               the caller checks NVIDIA's signed verdict against NVIDIA's own keys, so this forwarder cannot forge a result.
//  - /manifest  Public round manifests. The root must really be the Merkle root of the leaves, so nobody can publish a lie under a root.
// Nothing here logs request bodies, and no plaintext ever reaches this code.

export interface Chain {
  view(method: string, args: object): Promise<any>;
  hasAccessKey(accountId: string, publicKey: string): Promise<boolean>;
}
export interface Storage {
  put(bucket: string, path: string, body: string): Promise<void>;
  /** Short-lived URL, or null if the object does not exist. */
  signedDownloadUrl(bucket: string, path: string, seconds: number): Promise<string | null>;
  remove(bucket: string, path: string): Promise<void>;
  exists(bucket: string, path: string): Promise<boolean>;
}
export interface Deps {
  secret: string;
  now(): number;
  verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
  chain: Chain;
  storage: Storage;
  newId(): string;
  /** POSTs JSON to NVIDIA's NRAS and returns its response. Injected so tests never touch the network. */
  nras(body: string): Promise<Response>;
}

export const RECIPIENT = "veil-blob-gate";
const LOGIN_PREFIX = "veil-blob-gate login ";
const TOKEN_TTL_S = 3600, SKEW_S = 300, MAX_BLOB = 5_000_000, MAX_NRAS = 2_000_000;
export const NRAS_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";

const te = new TextEncoder();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => { if (h.length % 2 || /[^0-9a-f]/i.test(h)) throw new Error("bad hex"); return Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)); };
const b64 = (b: Uint8Array) => { let s = ""; b.forEach((x) => (s += String.fromCharCode(x))); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const sha = async (...parts: Uint8Array[]) => { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return new Uint8Array(await crypto.subtle.digest("SHA-256", o)); };

// ---- NEP-413 (borsh payload, sha256) ----
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(s: string): Uint8Array {
  let n = 0n; for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out: number[] = []; while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of s) { if (ch === "1") out.unshift(0); else break; }
  return Uint8Array.from(out);
}
const u32 = (n: number) => new Uint8Array(new Uint32Array([n]).buffer);
const bstr = (s: string) => { const b = te.encode(s); return [...u32(b.length), ...b]; };
export const nep413Hash = (message: string, nonce: Uint8Array, recipient: string) =>
  sha(new Uint8Array([...u32(2147484061), ...bstr(message), ...nonce, ...bstr(recipient), 0]));

// ---- Merkle root, identical to client/src/merkle.ts (a parity test guards this) ----
async function merkleRoot(leaves: string[]): Promise<string> {
  let cur = await Promise.all(leaves.map((l) => sha(Uint8Array.of(0), unhex(l))));
  while (cur.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? await sha(Uint8Array.of(1), cur[i], cur[i + 1]) : cur[i]);
    cur = next;
  }
  return hex(cur[0]);
}

// ---- tokens ----
async function mac(secret: string, data: string) {
  const k = await crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, te.encode(data))));
}
async function issueToken(d: Deps, account: string) {
  const exp = Math.floor(d.now() / 1000) + TOKEN_TTL_S, body = `${account}.${exp}`;
  return { token: `${body}.${await mac(d.secret, body)}`, expiresAt: exp * 1000 };
}
async function readToken(d: Deps, req: Request): Promise<string | null> {
  const t = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  const i = t.lastIndexOf("."); if (i < 0) return null;
  const body = t.slice(0, i), sig = t.slice(i + 1), j = body.lastIndexOf("."); if (j < 0) return null;
  if ((await mac(d.secret, body)) !== sig) return null;
  if (Number(body.slice(j + 1)) * 1000 < d.now()) return null;
  return body.slice(0, j);
}

// ---- http ----
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (status: number, error: string) => json(status, { error });
const isAccount = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9._-]{2,64}$/.test(s);
const isHash = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
/** blob_id is "sb:<account>/<id>". Returns the storage path, or null if malformed. */
export function blobPath(blobId: unknown): string | null {
  const m = typeof blobId === "string" ? /^sb:([a-z0-9._-]{2,64})\/([A-Za-z0-9_-]{8,64})$/.exec(blobId) : null;
  return m ? `${m[1]}/${m[2]}` : null;
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return fail(405, "POST only");
  const pathname = new URL(req.url).pathname.replace(/\/+$/, "");
  const route = pathname.split("/").pop();
  let raw = ""; try { raw = await req.text(); } catch { return fail(400, "unreadable body"); }
  let body: any; try { body = JSON.parse(raw); } catch { return fail(400, "body must be JSON"); }

  if (pathname.endsWith("/nras/v3/attest/gpu")) {
    if (raw.length > MAX_NRAS) return fail(413, "evidence too large");
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.nonce !== "string" || !Array.isArray(body.evidence_list)) return fail(400, "not GPU attestation evidence");
    const r = await d.nras(raw);
    return new Response(await r.text(), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  if (route === "auth") {
    const { accountId, publicKey, signature, message, nonce } = body ?? {};
    if (!isAccount(accountId) || typeof publicKey !== "string" || typeof signature !== "string" || typeof message !== "string" || typeof nonce !== "string") return fail(400, "bad auth request");
    if (!message.startsWith(LOGIN_PREFIX)) return fail(400, "wrong message");
    const ts = Date.parse(message.slice(LOGIN_PREFIX.length));
    if (Number.isNaN(ts) || Math.abs(d.now() - ts) > SKEW_S * 1000) return fail(401, "message is stale");
    try {
      if (!publicKey.startsWith("ed25519:")) return fail(401, "unsupported key type");
      const h = await nep413Hash(message, unhex(nonce), RECIPIENT);
      if (!d.verify(b58(publicKey.slice(8)), h, unb64(signature))) return fail(401, "bad signature");
    } catch { return fail(401, "bad signature"); }
    if (!(await d.chain.hasAccessKey(accountId, publicKey))) return fail(401, "key does not belong to that account");
    return json(200, await issueToken(d, accountId));
  }

  const account = await readToken(d, req);
  if (!account) return fail(401, "sign in first");

  if (route === "upload") {
    const data = body?.data;
    if (typeof data !== "string" || data.length < 2 || data.length > MAX_BLOB) return fail(400, `data must be a string of at most ${MAX_BLOB} characters`);
    const path = `${account}/${d.newId()}`;
    await d.storage.put("blobs", path, data);
    return json(200, { blob_id: `sb:${path}` });
  }

  if (route === "download") {
    const path = blobPath(body?.blob_id);
    if (!path) return fail(400, "bad blob_id");
    let allowed = path.startsWith(`${account}/`); // your own object
    if (!allowed) {
      const { session_hash, model_id } = body ?? {};
      if (!isHash(session_hash) || typeof model_id !== "string") return fail(403, "not yours: name the session and model");
      const s = await d.chain.view("get_session", { session_hash });
      if (!s || s.blob_id !== body.blob_id || s.forgotten) return fail(403, "no such live session");
      const m = await d.chain.view("get_model", { model_id });
      if (!m || m.owner !== account) return fail(403, "you do not own that model");
      if (!(await d.chain.view("has_consent", { session_hash, model_id }))) return fail(403, "no live consent for that model");
      allowed = true;
    }
    const url = await d.storage.signedDownloadUrl("blobs", path, 60);
    return url ? json(200, { url }) : fail(404, "blob not found");
  }

  if (route === "delete") {
    const path = blobPath(body?.blob_id);
    if (!path) return fail(400, "bad blob_id");
    if (!path.startsWith(`${account}/`)) return fail(403, "you can delete only your own blobs");
    await d.storage.remove("blobs", path);
    return json(200, { deleted: !(await d.storage.exists("blobs", path)) });
  }

  if (route === "manifest") {
    const { root, leaves } = body ?? {};
    if (!isHash(root) || !Array.isArray(leaves) || leaves.length < 1 || leaves.length > 2000 || !leaves.every(isHash)) return fail(400, "bad manifest");
    if ((await merkleRoot(leaves)) !== root) return fail(400, "root is not the Merkle root of the leaves");
    if (!(await d.storage.exists("rounds", `${root}.json`))) await d.storage.put("rounds", `${root}.json`, JSON.stringify({ root, leaves }));
    return json(200, { ok: true });
  }

  return fail(404, "unknown route");
}

/** Reads the NEAR contract through the first healthy RPC endpoint. */
export function makeChain(contract: string, rpcs: string[], f: typeof fetch = (...a) => fetch(...a)): Chain {
  async function rpc(method: string, params: unknown) {
    let last: unknown;
    for (const url of rpcs) {
      try {
        const r = await f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "g", method, params }) });
        const j = await r.json();
        if (j.error) { if (j.error.cause?.name === "UNKNOWN_ACCESS_KEY") throw Object.assign(new Error("no key"), { final: true }); throw new Error(JSON.stringify(j.error)); }
        return j.result;
      } catch (e) { if ((e as any)?.final) throw e; last = e; }
    }
    throw last instanceof Error ? last : new Error("all RPC endpoints failed");
  }
  return {
    async view(method, args) {
      const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) });
      return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
    },
    async hasAccessKey(accountId, publicKey) {
      try { await rpc("query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey }); return true; }
      catch { return false; }
    },
  };
}
