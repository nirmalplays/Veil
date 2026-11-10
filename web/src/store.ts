// Per-account local records. DEV: session keys sit in localStorage; a production build would wrap them with a wallet-derived key.
export interface LocalSession {
  hash: string; blobId: string; keyHex: string; title: string; createdMs: number;
  provider: string; private: boolean; committed: boolean;
  /** Models this session has ever been shared with. Used to report what remains after Forget. */
  sharedWith?: string[]; forgotten?: boolean;
  /** What remained when the user forgot this session (see forgetResidue). */
  residue?: { kind: string; measured: boolean; detail: string }[];
}
const k = (acct: string) => `veil:sessions:${acct}`;
export function loadSessions(acct: string): LocalSession[] {
  try { return JSON.parse(localStorage.getItem(k(acct)) ?? "[]"); } catch { return []; }
}
export function saveSession(acct: string, s: LocalSession) {
  const all = loadSessions(acct).filter((x) => x.hash !== s.hash); all.unshift(s);
  localStorage.setItem(k(acct), JSON.stringify(all));
}
export function markCommitted(acct: string, hash: string) {
  localStorage.setItem(k(acct), JSON.stringify(loadSessions(acct).map((s) => (s.hash === hash ? { ...s, committed: true } : s))));
}
export function updateSession(acct: string, hash: string, f: (s: LocalSession) => LocalSession) {
  localStorage.setItem(k(acct), JSON.stringify(loadSessions(acct).map((s) => (s.hash === hash ? f(s) : s))));
}
export interface OwnerKey { publicKey: string; secretKey: string }
export const loadOwnerKey = (model: string): OwnerKey | undefined => {
  try { return JSON.parse(localStorage.getItem(`veil:ownerkey:${model}`) ?? "null") ?? undefined; } catch { return undefined; }
};
export const saveOwnerKey = (model: string, kp: OwnerKey) => localStorage.setItem(`veil:ownerkey:${model}`, JSON.stringify(kp));
