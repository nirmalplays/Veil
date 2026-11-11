// NEAR AI Cloud E2EE v2 (Ed25519 keys): X25519 ECDH -> HKDF-SHA256 (info "ed25519_encryption") -> XChaCha20-Poly1305.
// Wire format: ephemeral_pub(32) || nonce(24) || ciphertext+tag. Ref: docs.near.ai/cloud/guides/e2ee-chat-completions
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromHex, toHex } from "./crypto.js";

const INFO = new TextEncoder().encode("ed25519_encryption");
const key = (shared: Uint8Array) => hkdf(sha256, shared, undefined, INFO, 32);

export interface ClientKeys { pubHex: string; x25519Secret: Uint8Array } // pubHex is the ed25519 key sent as X-Client-Pub-Key

export function generateClientKeys(): ClientKeys {
  const { secretKey, publicKey } = ed25519.keygen();
  return { pubHex: toHex(publicKey), x25519Secret: ed25519.utils.toMontgomerySecret(secretKey) };
}

/**
 * Encrypts with a caller-chosen ephemeral secret and nonce, so the same inputs always give the same ciphertext. Used to seal a knowledge base:
 * the relay can derive the secret again later and prove what it sealed. Never reuse one (secret, nonce) pair for different plaintexts.
 */
export function e2eeEncryptWith(plaintext: string, recipientEd25519PubHex: string, ephemeralSecretHex: string, nonceHex: string): string {
  const pub = fromHex(recipientEd25519PubHex);
  if (pub.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  const eph = fromHex(ephemeralSecretHex), nonce = fromHex(nonceHex);
  if (eph.length !== 32 || nonce.length !== 24) throw new Error("ephemeral secret must be 32 bytes and the nonce 24");
  const k = key(x25519.getSharedSecret(eph, ed25519.utils.toMontgomery(pub)));
  const ct = xchacha20poly1305(k, nonce).encrypt(new TextEncoder().encode(plaintext));
  return toHex(new Uint8Array([...x25519.getPublicKey(eph), ...nonce, ...ct]));
}

/** Encrypts to the model key and also returns the ephemeral secret, so the sender can later prove what was sent. */
export function e2eeEncryptKeep(plaintext: string, recipientEd25519PubHex: string): { data: string; ephemeralSecret: string } {
  const eph = x25519.utils.randomSecretKey();
  return { data: e2eeEncryptWith(plaintext, recipientEd25519PubHex, toHex(eph), toHex(crypto.getRandomValues(new Uint8Array(24)))), ephemeralSecret: toHex(eph) };
}
export function e2eeEncrypt(plaintext: string, recipientEd25519PubHex: string): string {
  return e2eeEncryptKeep(plaintext, recipientEd25519PubHex).data;
}
/** Opens a message the sender encrypted, using the kept ephemeral secret and the model's public key. */
export function e2eeOpenSent(dataHex: string, ephemeralSecretHex: string, recipientEd25519PubHex: string): string {
  const d = fromHex(dataHex);
  if (d.length < 32 + 24 + 16) throw new Error("ciphertext too short");
  const k = key(x25519.getSharedSecret(fromHex(ephemeralSecretHex), ed25519.utils.toMontgomery(fromHex(recipientEd25519PubHex))));
  return new TextDecoder().decode(xchacha20poly1305(k, d.slice(32, 56)).decrypt(d.slice(56)));
}
export function e2eeDecrypt(dataHex: string, x25519Secret: Uint8Array): string {
  const d = fromHex(dataHex);
  if (d.length < 32 + 24 + 16) throw new Error("ciphertext too short");
  const k = key(x25519.getSharedSecret(x25519Secret, d.slice(0, 32)));
  return new TextDecoder().decode(xchacha20poly1305(k, d.slice(32, 56)).decrypt(d.slice(56)));
}

/**
 * Checks what can be checked cheaply and offline on a gateway attestation report, and returns the model key to pin.
 * - model_attestations is non-empty and every candidate echoes OUR nonce,
 * - the TDX quote's REPORT_DATA equals signing_address || nonce, i.e. the key and nonce are bound to the quote.
 * NOT done here: Intel DCAP signature/cert-chain verification and NVIDIA payload verification (use NEAR's
 * verification guides / an external verifier); the UI labels this "binding checked", not "hardware verified".
 */
export interface KeyCheck { ok: boolean; publicKey?: string; checks: Record<string, boolean>; reasons: string[] }
export function checkModelAttestation(report: any, nonce: string, candidateIndex = 0): KeyCheck {
  const reasons: string[] = [];
  const checks: Record<string, boolean> = {};
  const list: any[] = report?.model_attestations ?? [];
  checks.hasCandidates = list.length > 0;
  if (!checks.hasCandidates) return { ok: false, checks, reasons: ["model_attestations missing or empty"] };
  checks.nonceEchoed = list.every((c) => c.request_nonce === nonce);
  const c = list[candidateIndex];
  checks.keyIsEd25519 = c?.signing_algo === "ed25519" && /^[0-9a-f]{64}$/.test(c?.signing_public_key ?? "");
  const rd = quoteReportData(c?.intel_quote);
  checks.quoteBindsKeyAndNonce = !!rd && rd === (c?.signing_public_key + nonce).toLowerCase();
  for (const [k, v] of Object.entries(checks)) if (!v) reasons.push(`failed: ${k}`);
  const ok = Object.values(checks).every(Boolean);
  return { ok, publicKey: ok ? c.signing_public_key : undefined, checks, reasons };
}

/** REPORT_DATA (64 bytes) of a TDX v4 quote: 48-byte header + 520 bytes into the TD report body. */
export function quoteReportData(quoteHex?: string): string | undefined {
  if (!quoteHex || quoteHex.length < (48 + 584) * 2) return undefined;
  return quoteHex.slice((48 + 520) * 2, (48 + 584) * 2).toLowerCase();
}
