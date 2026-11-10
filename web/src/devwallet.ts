// Inline wallet: a throwaway TESTNET key generated and kept in this browser, so the app works without any wallet popup.
// The key lives in localStorage; anyone with access to this browser profile can spend this account. Testnet only.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { CONTRACT, RPCS } from "./config";

const FAUCET = "https://helper.nearprotocol.com/account";
const SK = "veil:inline"; // { accountId, secret }
const AK = "veil:inline-active";
const ENV_ACCOUNT: string | undefined = import.meta.env.VITE_DEV_ACCOUNT;
const ENV_KEY: string | undefined = import.meta.env.VITE_DEV_KEY;

interface Stored { accountId: string; secret: string }
function stored(): Stored | undefined {
  if (ENV_ACCOUNT && ENV_KEY) return { accountId: ENV_ACCOUNT, secret: ENV_KEY };
  try { return JSON.parse(localStorage.getItem(SK) ?? "null") ?? undefined; } catch { return undefined; }
}
export const hasInline = () => !!stored();
export const inlineAccountId = () => stored()?.accountId;
/** Active = a key exists and the user has not signed out of it (env-provided keys are always active). */
export const inlineActive = () => !!stored() && (!!(ENV_ACCOUNT && ENV_KEY) || localStorage.getItem(AK) === "1");
export const activateInline = () => localStorage.setItem(AK, "1");
export const deactivateInline = () => localStorage.removeItem(AK);
export const exportInlineKey = () => stored()?.secret;
export const deleteInline = () => { localStorage.removeItem(SK); localStorage.removeItem(AK); cached = undefined; };

let cached: { signer: KeyPairSigner; account: Account } | undefined;
function dev() {
  const s = stored();
  if (!s) throw new Error("no inline wallet");
  if (!cached) {
    const signer = new KeyPairSigner(KeyPair.fromString(s.secret as `ed25519:${string}`));
    cached = { signer, account: new Account(s.accountId, new JsonRpcProvider({ url: RPCS[0] }), signer) };
  }
  return cached;
}

/** Generate a key, ask the testnet faucet to create `veil-xxxxxx.testnet` for it, and keep the key here. */
export async function createInline(): Promise<string> {
  const kp = KeyPair.fromRandom("ed25519");
  const accountId = `veil-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("")}.testnet`;
  const r = await fetch(FAUCET, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: kp.getPublicKey().toString() }) });
  if (!r.ok) throw new Error(`faucet refused (${r.status}): ${(await r.text()).slice(0, 160)}`);
  localStorage.setItem(SK, JSON.stringify({ accountId, secret: kp.toString() }));
  localStorage.setItem(AK, "1"); cached = undefined;
  // wait for the account to exist before first use
  for (let i = 0; i < 20; i++) {
    try { await dev().account.getState(); return accountId; } catch { await new Promise((res) => setTimeout(res, 1500)); }
  }
  return accountId;
}

export async function devSignNep413(message: string, recipient: string, nonce: Uint8Array, callbackUrl?: string) {
  const s = await (dev().signer as any).signNep413Message(stored()!.accountId, { message, recipient, nonce, callbackUrl });
  const sig: any = s.signature;
  const bytes: Uint8Array = sig instanceof Uint8Array ? sig : Uint8Array.from(atob(String(sig)), (c) => c.charCodeAt(0));
  let b64 = ""; bytes.forEach((b) => (b64 += String.fromCharCode(b)));
  return { accountId: s.accountId, publicKey: s.publicKey.toString(), signature: btoa(b64) };
}

export async function devCall(methodName: string, args: object) {
  await dev().account.callFunction({ contractId: CONTRACT, methodName, args: args as Record<string, any>, gas: 30_000_000_000_000n, deposit: 0n, waitUntil: "FINAL" });
}
