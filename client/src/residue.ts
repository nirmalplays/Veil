// What is left after a session is forgotten. Forgetting stops future use; it cannot undo the past.
// Each item says whether we measured it or can only state it.
export interface ResidueInput {
  sessionHash: string;
  /** Models the session was ever shared with (from the user's own records). */
  sharedWith: string[];
  /** Score recorded on-chain per model, if any. */
  evals: Record<string, number | undefined>;
  /** Rounds per model. `leaves` is the round manifest when it could be fetched; without it inclusion is unknown. */
  rounds: { model: string; root: string; leaves?: string[] }[];
  /** After a delete attempt: true = the blob is gone, false = still served, undefined = not checked. */
  blobGone?: boolean;
}
export type ResidueKind = "round" | "eval" | "wrapped-key" | "blob" | "owner-copy";
export interface ResidueItem { kind: ResidueKind; measured: boolean; detail: string }

const short = (s: string) => (s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s);

export function forgetResidue(i: ResidueInput): ResidueItem[] {
  const out: ResidueItem[] = [];
  for (const r of i.rounds) {
    if (!r.leaves) out.push({ kind: "round", measured: false, detail: `Could not check whether ${r.model}'s round ${short(r.root)} included this session.` });
    else if (r.leaves.includes(i.sessionHash)) out.push({ kind: "round", measured: true, detail: `${r.model}'s round ${short(r.root)} already scored or used this session. Past rounds stay on-chain as a record.` });
  }
  for (const [model, score] of Object.entries(i.evals)) {
    if (score !== undefined) out.push({ kind: "eval", measured: true, detail: `${model} recorded a score of ${score} for this session. Scores are never altered.` });
  }
  for (const model of i.sharedWith) {
    out.push({ kind: "wrapped-key", measured: true, detail: `The key wrapped for ${model} was written to the chain when you shared it and stays in chain history. It opens nothing once the blob is gone.` });
  }
  out.push(i.blobGone === true
    ? { kind: "blob", measured: true, detail: "The encrypted blob was deleted from the store." }
    : i.blobGone === false
      ? { kind: "blob", measured: true, detail: "The encrypted blob is still being served. Deletion did not take effect." }
      : { kind: "blob", measured: false, detail: "Blob deletion was not checked." });
  out.push({ kind: "owner-copy", measured: false, detail: "A model owner who decrypted the session while consent was live may still hold a copy. This cannot be measured or removed." });
  return out;
}
