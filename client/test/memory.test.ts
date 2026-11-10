import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMemoryPrompt, rank, tokenize, type Doc } from "../src/memory.js";

const docs: Doc[] = [
  { id: "a", text: "user: how do I refactor nested loops in python\nassistant: use list comprehensions or itertools.product" },
  { id: "b", text: "user: reconcile a ledger with duplicate invoices\nassistant: group by invoice id and compare totals" },
  { id: "c", text: "user: what should I cook tonight\nassistant: pasta with garlic and olive oil" },
];

test("tokenize lowercases, drops stopwords and one-letter tokens", () => {
  assert.deepEqual(tokenize("The Quick brown fox, and a Dog!"), ["quick", "brown", "fox", "dog"]);
});
test("the most relevant session ranks first", () => {
  const h = rank("refactor python loops", docs, 3);
  assert.equal(h[0].id, "a");
});
test("sessions that share no words with the question are never returned", () => {
  const h = rank("refactor python loops", docs, 3);
  assert.deepEqual(h.map((x) => x.id), ["a"]);
});
test("k limits the number of hits, ordered by score then id", () => {
  const same: Doc[] = [{ id: "z", text: "invoice totals" }, { id: "y", text: "invoice totals" }, { id: "x", text: "invoice totals" }];
  assert.deepEqual(rank("invoice totals", same, 2).map((x) => x.id), ["x", "y"]);
});
test("an empty corpus or an empty question gives no hits", () => {
  assert.deepEqual(rank("anything", [], 3), []);
  assert.deepEqual(rank("   ", docs, 3), []);
  assert.deepEqual(rank("the and of", docs, 3), []);
});
test("a rarer shared word counts for more than a common one", () => {
  const corpus: Doc[] = [{ id: "common", text: "report report report data" }, { id: "rare", text: "ledger reconciliation notes" }, { id: "x", text: "data data data data" }, { id: "y", text: "data sheet" }];
  assert.equal(rank("ledger data", corpus, 4)[0].id, "rare");
});
test("the memory prompt numbers sources, labels them as untrusted, and respects the size cap", () => {
  const hits = rank("invoice ledger", docs, 3);
  const p = buildMemoryPrompt(hits, 400);
  assert.match(p, /\[1\]/);
  assert.match(p, /may be irrelevant/i);
  assert.ok(p.length <= 400 + 400, "bounded");
  const long = buildMemoryPrompt([{ id: "q", score: 1, text: "x".repeat(10_000) }], 1000);
  assert.ok(long.length < 1600);
});
test("no hits gives an empty prompt, so nothing is added to the request", () => assert.equal(buildMemoryPrompt([], 1000), ""));

test("a session that only shares a filler word with the question is not retrieved", () => {
  const corpus: Doc[] = [
    { id: "ops", text: "user: our staging deploy keeps failing on the Bluefin pipeline\nassistant: the Bluefin pipeline needs REGION_LOCK set before the migrate step" },
    { id: "cook", text: "user: what should I cook tonight\nassistant: pasta with garlic and olive oil" },
  ];
  const h = rank("Our Bluefin pipeline deploy is timing out at the migrate step. What should I check?", corpus, 3);
  assert.deepEqual(h.map((x) => x.id), ["ops"]);
});
test("weak matches are dropped relative to the best one", () => {
  const corpus: Doc[] = [
    { id: "strong", text: "invoice ledger reconciliation duplicate invoice totals ledger" },
    { id: "weak", text: "meeting notes about the quarterly offsite and a ledger mention" },
  ];
  assert.deepEqual(rank("reconcile invoice ledger totals", corpus, 3).map((x) => x.id), ["strong"]);
});
