// Consent key sharing: wrap a session's AES key to a model owner's X25519 public key (ECIES-style).
// Wire format (hex): ephemeralPub(32) || iv(12) || AES-256-GCM(sessionKey, aad = session hash).
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromHex, toHex } from "./crypto.js";

const te = new TextEncoder();
const INFO = te.encode("veil-keywrap-v1");

export interface EncKeyPair { publicKey: string; secretKey: string } // 64-hex each

/** Model owner generates this once; `publicKey` goes into `register_model(enc_pubkey)`. */
export function generateEncKeyPair(): EncKeyPair {
  const sk = x25519.utils.randomSecretKey();
  return { publicKey: toHex(x25519.getPublicKey(sk)), secretKey: toHex(sk) };
}

async function wrapKeyMaterial(secret: Uint8Array, ephPub: Uint8Array, recipPub: Uint8Array) {
  const salt = new Uint8Array([...ephPub, ...recipPub]);
  const raw = hkdf(sha256, secret, salt, INFO, 32);
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** `aad` should be the session hash so a wrapped key can't be replayed onto another session. */
export async function wrapSessionKey(sessionKeyHex: string, recipientPubHex: string, aad: string): Promise<string> {
  const recip = fromHex(recipientPubHex);
  if (recip.length !== 32) throw new Error("recipient key must be 32 bytes");
  const eph = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(eph);
  const k = await wrapKeyMaterial(x25519.getSharedSecret(eph, recip), ephPub, recip);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: te.encode(aad) }, k, fromHex(sessionKeyHex) as BufferSource));
  return toHex(ephPub) + toHex(iv) + toHex(ct);
}

/** Returns the session key as hex; feed it to `importKey`. Throws on wrong key, wrong aad, or tampering. */
export async function unwrapSessionKey(wrappedHex: string, secretKeyHex: string, aad: string): Promise<string> {
  const w = fromHex(wrappedHex);
  if (w.length < 32 + 12 + 16) throw new Error("wrapped key too short");
  const sk = fromHex(secretKeyHex);
  const ephPub = w.slice(0, 32), iv = w.slice(32, 44), ct = w.slice(44);
  const recipPub = x25519.getPublicKey(sk);
  const k = await wrapKeyMaterial(x25519.getSharedSecret(sk, ephPub), ephPub, recipPub);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: te.encode(aad) }, k, ct as BufferSource);
  return toHex(new Uint8Array(pt));
}
