// Pure view of a consent record, matching the contract's rules. Callers treat a forgotten session as "none".
export interface ConsentRecord {
  /** null / undefined means pinned (no expiry). */
  expires_ms?: number | null;
  paused?: boolean;
}
export type ConsentState = "active" | "pinned" | "muted" | "expired" | "none";

/** Muted wins over everything else, then pinned, then expiry decides active vs expired. */
export function consentState(consent: ConsentRecord | null | undefined, now: number): ConsentState {
  if (!consent) return "none";
  if (consent.paused) return "muted";
  if (consent.expires_ms == null) return "pinned";
  return consent.expires_ms > now ? "active" : "expired";
}
