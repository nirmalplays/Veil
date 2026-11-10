import { test } from "node:test";
import assert from "node:assert/strict";
import { forgetResidue } from "../src/residue.js";

const H = "ab".repeat(32);
const kinds = (r: ReturnType<typeof forgetResidue>) => r.map((x) => x.kind);

test("a never-shared session leaves only the blob and the unmeasurable owner copy note", () => {
  const r = forgetResidue({ sessionHash: H, sharedWith: [], evals: {}, rounds: [], blobGone: true });
  assert.deepEqual(kinds(r), ["blob", "owner-copy"]);
  assert.equal(r[0].measured, true);
  assert.equal(r.at(-1)!.measured, false);
});
test("a round that included the session is reported, one that did not is not", () => {
  const r = forgetResidue({ sessionHash: H, sharedWith: ["m1"], evals: { m1: 80 }, blobGone: true,
    rounds: [{ model: "m1", root: "c".repeat(64), leaves: [H, "ff".repeat(32)] }, { model: "m1", root: "d".repeat(64), leaves: ["ff".repeat(32)] }] });
  assert.equal(r.filter((x) => x.kind === "round").length, 1);
  assert.ok(r.some((x) => x.kind === "eval" && x.detail.includes("80")));
  assert.ok(r.some((x) => x.kind === "wrapped-key" && x.detail.includes("m1")));
});
test("a round whose manifest is missing is flagged as unmeasured, not silently skipped", () => {
  const r = forgetResidue({ sessionHash: H, sharedWith: ["m1"], evals: {}, rounds: [{ model: "m1", root: "e".repeat(64) }] });
  const round = r.find((x) => x.kind === "round")!;
  assert.equal(round.measured, false);
});
test("blob state: gone, still served, not checked", () => {
  const f = (blobGone?: boolean) => forgetResidue({ sessionHash: H, sharedWith: [], evals: {}, rounds: [], blobGone }).find((x) => x.kind === "blob")!;
  assert.ok(f(true).detail.includes("deleted") && f(true).measured);
  assert.ok(f(false).detail.includes("still being served") && f(false).measured);
  assert.ok(f(undefined).detail.includes("not checked") && !f(undefined).measured);
});
