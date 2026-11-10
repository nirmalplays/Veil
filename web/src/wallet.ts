import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { CONTRACT } from "./config";
import { hasAccessKey } from "./chain";
import { activateInline, createInline, deactivateInline, devCall, devSignNep413, hasInline, inlineActive, inlineAccountId } from "./devwallet";
export { createInline, hasInline, inlineActive, inlineAccountId, activateInline } from "./devwallet";

export const RECIPIENT = "veil";
const TAG = 2147484061; // 2^31 + 413

// ---- NEP-413 verification (borsh payload -> sha256 -> ed25519), kept local so the check is auditable ----
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of s) { if (ch === "1") bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
}
const u32 = (n: number) => new Uint8Array(new Uint32Array([n]).buffer);
const str = (s: string) => { const b = new TextEncoder().encode(s); return [...u32(b.length), ...b]; };

export function nep413Hash(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string): Uint8Array {
  const payload = new Uint8Array([
    ...u32(TAG), ...str(message), ...nonce, ...str(recipient),
    ...(callbackUrl ? [1, ...str(callbackUrl)] : [0]),
  ]);
  return sha256(payload);
}
export function verifyNep413(a: { publicKey: string; signature: string; message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string }): boolean {
  if (!a.publicKey.startsWith("ed25519:")) return false;
  const pk = b58decode(a.publicKey.slice(8));
  const sig = Uint8Array.from(atob(a.signature), (c) => c.charCodeAt(0));
  return ed25519.verify(sig, nep413Hash(a.message, a.nonce, a.recipient, a.callbackUrl), pk);
}

// ---- wallet selector ----
let selector: WalletSelector | undefined;
export async function getSelector(): Promise<WalletSelector> {
  selector ??= await setupWalletSelector({ network: "testnet", modules: [setupMeteorWallet()] });
  return selector;
}
export async function openModal() {
    setupModal(await getSelector(), { contractId: CONTRACT }).show();
}
export async function currentAccount(): Promise<string | undefined> {
  if (inlineActive()) return inlineAccountId();
  const s = await getSelector();
  return s.store.getState().accounts.find((a) => a.active)?.accountId ?? s.store.getState().accounts[0]?.accountId;
}
export async function signOut() { if (inlineActive()) { deactivateInline(); return; } await (await getSelector()).wallet().then((w) => w.signOut()); }

export interface Proof { accountId: string; publicKey: string; ok: boolean; detail: string }

/** Ask the wallet to sign a fresh login challenge (NEP-413), then verify signature + that the key belongs to the account. */
export async function loginChallenge(): Promise<Proof | undefined> {
  if (inlineActive()) {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const message = `Log in to Veil at ${new Date().toISOString()}`;
    const cb = location.origin + location.pathname;
    return checkSigned(await devSignNep413(message, RECIPIENT, nonce, cb), message, nonce);
  }
  const w = await (await getSelector()).wallet();
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const message = `Log in to Veil at ${new Date().toISOString()}`;
  localStorage.setItem("veil:pending-nonce", JSON.stringify({ message, nonce: Array.from(nonce) }));
  const signed = await (w as any).signMessage({ message, recipient: RECIPIENT, nonce: nonce as any,
    callbackUrl: location.origin + location.pathname });
  if (!signed) return undefined; // redirect wallet: result arrives on return, see consumeRedirect()
  return checkSigned(signed, message, nonce);
}

async function checkSigned(s: { accountId: string; publicKey: string; signature: string }, message: string, nonce: Uint8Array): Promise<Proof> {
  const sigOk = verifyNep413({ publicKey: s.publicKey, signature: s.signature, message, nonce, recipient: RECIPIENT,
    callbackUrl: location.origin + location.pathname });
  const keyOk = sigOk && (await hasAccessKey(s.accountId, s.publicKey));
  localStorage.removeItem("veil:pending-nonce");
  return { accountId: s.accountId, publicKey: s.publicKey, ok: sigOk && keyOk,
    detail: !sigOk ? "signature invalid" : !keyOk ? "key is not an access key of this account" : "signature valid, key belongs to account" };
}

/** Browser wallets (MyNearWallet) return the signature in the URL hash after redirect. */
export async function consumeRedirect(): Promise<Proof | undefined> {
  const h = new URLSearchParams(location.hash.slice(1));
  const accountId = h.get("accountId"), publicKey = h.get("publicKey"), signature = h.get("signature");
  const pending = localStorage.getItem("veil:pending-nonce");
  if (!accountId || !publicKey || !signature || !pending) return undefined;
  history.replaceState(null, "", location.pathname + location.search);
  const { message, nonce } = JSON.parse(pending);
  return checkSigned({ accountId, publicKey, signature }, message, Uint8Array.from(nonce));
}

export async function call(methodName: string, args: object, gas = "30000000000000"): Promise<void> {
  if (inlineActive()) return devCall(methodName, args);
  const w = await (await getSelector()).wallet();
  await w.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [{ type: "FunctionCall", params: { methodName, args, gas, deposit: "0" } }] as any,
  });
}

/** Several contract calls under one wallet approval. */
export async function callMany(calls: { methodName: string; args: object }[], gas = "30000000000000"): Promise<void> {
  if (inlineActive()) { for (const c of calls) await devCall(c.methodName, c.args); return; }
  const w = await (await getSelector()).wallet();
  await (w as any).signAndSendTransactions({
    transactions: calls.map((c) => ({ receiverId: CONTRACT,
      actions: [{ type: "FunctionCall", params: { methodName: c.methodName, args: c.args, gas, deposit: "0" } }] })) as any,
  });
}

/** Sign an arbitrary NEP-413 message with the active wallet (used to sign in to the blob gate). */
export async function signFor(message: string, recipient: string, nonce: Uint8Array): Promise<{ accountId: string; publicKey: string; signature: string }> {
  if (inlineActive()) return devSignNep413(message, recipient, nonce);
  const wlt = await (await getSelector()).wallet();
  const s = await (wlt as any).signMessage({ message, recipient, nonce: nonce as any });
  if (!s) throw new Error("This wallet signs by redirect, which storage sign-in does not support yet. Use the inline wallet or Meteor.");
  return s;
}
