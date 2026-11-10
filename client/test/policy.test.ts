import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalPolicy, checkRules, policyHash, type Policy } from "../src/policy.js";

const p: Policy = { prompt: "You are an assistant.", rules: [
  { type: "max_words", n: 10 },
  { type: "must_include", text: "AI" },
  { type: "must_not_include", text: "guarantee" },
  { type: "must_not_match", pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b", label: "social security number" },
] };
const run = (reply: string) => checkRules(p.rules, reply);

test("a compliant reply passes every rule", () => {
  const r = run("I am an AI and cannot advise you.");
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  assert.equal(r.length, 4);
});
test("each rule type catches its violation", () => {
  assert.equal(run("I am an AI. " + "word ".repeat(12)).find((x) => x.rule.type === "max_words")!.ok, false);
  assert.equal(run("Hello there.").find((x) => x.rule.type === "must_include")!.ok, false);
  assert.equal(run("As an AI I guarantee a win.").find((x) => x.rule.type === "must_not_include")!.ok, false);
  assert.equal(run("As an AI: 123-45-6789").find((x) => x.rule.type === "must_not_match")!.ok, false);
});
test("text rules are case-insensitive, but whole-word for short tokens is not required", () => {
  assert.ok(checkRules([{ type: "must_include", text: "ai assistant" }], "I am an AI Assistant.")[0].ok);
  assert.equal(checkRules([{ type: "must_not_include", text: "Guarantee" }], "no GUARANTEE here")[0].ok, false);
});
test("word counting ignores extra whitespace", () => {
  assert.ok(checkRules([{ type: "max_words", n: 3 }], "  one   two\nthree  ")[0].ok);
  assert.equal(checkRules([{ type: "max_words", n: 3 }], "one two three four")[0].ok, false);
});
test("a bad regex is reported as a failed rule, not a crash", () => {
  const r = checkRules([{ type: "must_not_match", pattern: "(" }], "x");
  assert.equal(r[0].ok, false);
  assert.match(r[0].detail, /invalid/i);
});
test("no rules means nothing to check", () => assert.deepEqual(checkRules(undefined, "anything"), []));

test("the hash covers the prompt and every rule, and ignores key order", () => {
  const h = policyHash(p);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, policyHash({ ...p, prompt: p.prompt + " " }));
  assert.notEqual(h, policyHash({ ...p, rules: p.rules!.slice(1) }));
  assert.notEqual(h, policyHash({ ...p, rules: [{ type: "max_words", n: 11 }, ...p.rules!.slice(1)] }));
  const reordered = { rules: p.rules!.map((r) => Object.fromEntries(Object.entries(r).reverse())), prompt: p.prompt } as Policy;
  assert.equal(policyHash(reordered), h);
  assert.equal(canonicalPolicy({ prompt: "a" }), canonicalPolicy({ prompt: "a", rules: [] }));
});
