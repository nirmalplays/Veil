// Client-side AES-256-GCM. Keys never leave the user's device unless they choose to share one.
const te = new TextEncoder();
const td = new TextDecoder();

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string) => {
  if (h.length % 2) throw new Error("odd hex length");
  return Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
};

export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
export async function exportKey(k: CryptoKey): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.exportKey("raw", k)));
}
export async function importKey(hex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromHex(hex), "AES-GCM", true, ["encrypt", "decrypt"]);
}

export interface Sealed { iv: string; ciphertext: string }

/** `aad` binds the ciphertext to context (e.g. account id) so blobs can't be replayed elsewhere. */
export async function encrypt(key: CryptoKey, plaintext: string, aad = ""): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(aad) }, key, te.encode(plaintext));
  return { iv: toHex(iv), ciphertext: toHex(new Uint8Array(ct)) };
}
export async function decrypt(key: CryptoKey, s: Sealed, aad = ""): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromHex(s.iv), additionalData: te.encode(aad) }, key, fromHex(s.ciphertext));
  return td.decode(pt);
}

/** The value committed on-chain: sha256 over the sealed blob (iv || ciphertext), as 64-hex. */
export async function sessionHash(s: Sealed): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", fromHex(s.iv + s.ciphertext));
  return toHex(new Uint8Array(d));
}
