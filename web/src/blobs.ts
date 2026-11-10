// NO RETENTION BY US. This app has no backend of its own. The only server-side state is the blob store, and it
// only ever receives (a) AES-256-GCM ciphertext of sessions the user chose to save, which it cannot read, and
// (b) public round manifests (lists of session hashes). Chat plaintext and the NEAR AI key stay in the browser.
// Deleting a session ("Forget") deletes its blob. See README, "What is stored where".
//
// Two backends behind one API:
//  - gate:  Supabase Storage (or the local gate) behind the blob-gate function. Access is decided by the NEAR contract.
//  - local: the dev blob store (web/dev-blob-server.ts), no auth. Development only.
import { BLOB_URL, GATE_APIKEY, GATE_URL, ROUNDS_BASE } from "./config";
import { currentAccount, signFor } from "./wallet";

export const usingGate = !!GATE_URL;
export const storageLabel = usingGate ? "Supabase Storage via blob-gate" : "local dev blob store";

// ---- gate ----
let session: { account: string; token: string; exp: number } | undefined;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function gate<T = any>(route: string, body: unknown, token?: string): Promise<T> {
  const r = await fetch(`${GATE_URL}/${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...(GATE_APIKEY ? { apikey: GATE_APIKEY } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `storage ${route} failed (${r.status})`), { status: r.status });
  return j;
}
/** Signs a NEP-413 login for the blob gate once per hour per account. */
async function token(): Promise<string> {
  const account = await currentAccount();
  if (!account) throw new Error("Sign in first.");
  if (session && session.account === account && session.exp - 60_000 > Date.now()) return session.token;
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const message = `veil-blob-gate login ${new Date().toISOString()}`;
  const s = await signFor(message, "veil-blob-gate", nonce);
  const r = await gate<{ token: string; expiresAt: number }>("auth", { accountId: s.accountId, publicKey: s.publicKey, signature: s.signature, message, nonce: hex(nonce) });
  session = { account, token: r.token, exp: r.expiresAt };
  return r.token;
}
async function authed<T>(route: string, body: unknown): Promise<T> {
  try { return await gate<T>(route, body, await token()); }
  catch (e) { if ((e as any).status === 401) { session = undefined; return gate<T>(route, body, await token()); } throw e; }
}

// ---- public API ----
/** Upload ciphertext. Returns an opaque blob_id that goes on-chain. */
export async function putBlob(json: unknown): Promise<string> {
  if (usingGate) return (await authed<{ blob_id: string }>("upload", { data: JSON.stringify(json) })).blob_id;
  const r = await fetch(`${BLOB_URL}/blobs`, { method: "POST", body: JSON.stringify(json) });
  if (!r.ok) throw new Error(`blob upload failed: ${r.status}`);
  return `${BLOB_URL}/blobs/${(await r.json()).id}`;
}

/** `ctx` lets a model owner prove which session and model they are reading for; the gate checks live consent on-chain. */
export async function getBlob<T = any>(blobId: string, ctx?: { sessionHash: string; modelId: string }): Promise<T> {
  if (usingGate) {
    const { url } = await authed<{ url: string }>("download", { blob_id: blobId, session_hash: ctx?.sessionHash, model_id: ctx?.modelId });
    const r = await fetch(url);
    if (!r.ok) throw new Error(`blob fetch failed: ${r.status}`);
    return r.json();
  }
  const r = await fetch(blobId);
  if (!r.ok) throw new Error(`blob fetch failed: ${r.status}`);
  return r.json();
}

/** Delete our copy of an encrypted blob. Returns true only if the store confirms it is gone. */
export async function deleteBlob(blobId: string): Promise<boolean> {
  if (usingGate) {
    try { return !!(await authed<{ deleted: boolean }>("delete", { blob_id: blobId })).deleted; } catch { return false; }
  }
  try { await fetch(blobId, { method: "DELETE" }); } catch { return false; }
  try { return (await fetch(blobId)).status === 404; } catch { return false; }
}

/** Round manifests are public: the list of session hashes under a Merkle root, keyed by the root. */
export async function putManifest(root: string, leaves: string[]): Promise<void> {
  if (usingGate) { await authed("manifest", { root, leaves }); return; }
  const r = await fetch(`${BLOB_URL}/rounds/${root}`, { method: "PUT", body: JSON.stringify({ root, leaves }) });
  if (!r.ok && r.status !== 409) throw new Error(`manifest upload failed: ${r.status}`);
}
export async function getManifest(root: string): Promise<{ root: string; leaves: string[] }> {
  const r = await fetch(usingGate ? `${ROUNDS_BASE}/${root}.json` : `${BLOB_URL}/rounds/${root}`);
  if (!r.ok) throw new Error(`manifest not found: ${r.status}`);
  return r.json();
}
