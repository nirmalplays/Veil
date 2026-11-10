// Binary Merkle tree over 64-hex session hashes. Leaf/node domain separation prevents
// second-preimage attacks; unpaired nodes are promoted (never duplicated).
import { sha256 } from "@noble/hashes/sha2.js";
import { fromHex, toHex } from "./crypto.js";

const h = (prefix: number, ...parts: Uint8Array[]) => {
  const x = sha256.create().update(Uint8Array.of(prefix));
  parts.forEach((p) => x.update(p));
  return x.digest();
};
const leafHash = (hex: string) => h(0, fromHex(hex));

export interface ProofStep { sibling: string; side: "L" | "R" }

function levels(leaves: string[]): Uint8Array[][] {
  if (!leaves.length) throw new Error("no leaves");
  let cur: Uint8Array[] = leaves.map(leafHash);
  const out: Uint8Array[][] = [cur];
  while (cur.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2)
      next.push(i + 1 < cur.length ? h(1, cur[i], cur[i + 1]) : cur[i]);
    out.push((cur = next));
  }
  return out;
}

export const merkleRoot = (leaves: string[]) => toHex(levels(leaves).at(-1)![0]);

export function prove(leaves: string[], index: number): ProofStep[] {
  if (index < 0 || index >= leaves.length) throw new Error("index out of range");
  const proof: ProofStep[] = [];
  let i = index;
  for (const lvl of levels(leaves).slice(0, -1)) {
    const sib = i ^ 1;
    if (sib < lvl.length) proof.push({ sibling: toHex(lvl[sib]), side: sib < i ? "L" : "R" });
    i >>= 1;
  }
  return proof;
}

export function verify(leaf: string, proof: ProofStep[], root: string): boolean {
  let cur = leafHash(leaf);
  for (const s of proof) {
    const sib = fromHex(s.sibling);
    cur = s.side === "L" ? h(1, sib, cur) : h(1, cur, sib);
  }
  return toHex(cur) === root;
}
