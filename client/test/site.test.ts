import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPolicy, buildSite, formProblems, PRESETS, validateSiteId, type SiteForm } from "../src/site.js";
import { checkRules, policyHash } from "../src/policy.js";
import { verifyKb } from "../src/kb.js";

const form: SiteForm = {
  siteId: "acme-clinic", title: "Acme Clinic", greeting: "Hi, I'm an AI assistant.", fallback: "Please call us.", model: "z-ai/glm-5.3-flash", receipts: "visitor",
  prompt: "You are the intake assistant for Acme Clinic. Never diagnose.", maxWords: 60, mustMention: ["AI"], mustNeverSay: ["guarantee", "cure"], presets: ["ssn"],
};

test("site ids: lowercase letters, digits and dashes only", () => {
  for (const ok of ["ab", "acme-clinic", "a1-b2"]) assert.equal(validateSiteId(ok), null, ok);
  for (const bad of ["", "a", "Acme", "has space", "-lead", "x".repeat(42), "under_score", "a/b", "../x"]) assert.notEqual(validateSiteId(bad), null, bad);
});
test("the form becomes a policy with rules in a fixed order", () => {
  const p = buildPolicy(form);
  assert.equal(p.prompt, form.prompt);
  assert.deepEqual(p.rules!.map((r) => r.type), ["max_words", "must_include", "must_not_include", "must_not_include", "must_not_match"]);
});
test("blank, duplicate and padded entries are cleaned, and an empty form makes no rules", () => {
  const p = buildPolicy({ ...form, maxWords: null, mustMention: ["  AI ", "", "ai"], mustNeverSay: [" cure ", "cure", ""], presets: [] });
  assert.deepEqual(p.rules, [{ type: "must_include", text: "AI" }, { type: "must_not_include", text: "cure" }]);
  assert.deepEqual(buildPolicy({ ...form, maxWords: null, mustMention: [], mustNeverSay: [], presets: [] }).rules, []);
});
test("the same form always hashes the same, and any change moves the hash", () => {
  const h = policyHash(buildPolicy(form));
  assert.equal(policyHash(buildPolicy({ ...form })), h);
  assert.notEqual(policyHash(buildPolicy({ ...form, maxWords: 61 })), h);
  assert.notEqual(policyHash(buildPolicy({ ...form, prompt: form.prompt + "." })), h);
  assert.notEqual(policyHash(buildPolicy({ ...form, mustNeverSay: ["guarantee"] })), h);
});
test("presets catch what they say they catch", () => {
  const ssn = checkRules([PRESETS.ssn.rule], "my number is 123-45-6789")[0];
  assert.equal(ssn.ok, false);
  assert.ok(checkRules([PRESETS.ssn.rule], "call 555-1234")[0].ok);
  assert.equal(checkRules([PRESETS.card.rule], "card 4111 1111 1111 1111")[0].ok, false);
  assert.ok(checkRules([PRESETS.card.rule], "room 12 on floor 3")[0].ok);
});
test("the relay's site file carries the policy, contract and settings, and nothing secret", () => {
  const s = buildSite(form, "veil-31da02.testnet");
  assert.equal(s.siteId, "acme-clinic"); assert.equal(s.contract, "veil-31da02.testnet"); assert.equal(s.receipts, "visitor");
  assert.deepEqual(s.policy, buildPolicy(form)); assert.equal(s.fallback, "Please call us.");
  assert.ok(!JSON.stringify(s).toLowerCase().includes("key"));
});
test("problems are listed in plain words", () => {
  assert.deepEqual(formProblems(form), []);
  const p = formProblems({ ...form, siteId: "Bad Id", title: "", prompt: "  ", greeting: "" });
  assert.equal(p.length, 4);
  assert.ok(formProblems({ ...form, maxWords: 0 }).some((x) => /word/i.test(x)));
});

const withKb: SiteForm = { ...form, kbDocs: [{ title: "Hours", text: "Open 9 to 5." }, { title: "Fees", text: "A visit costs 50 dollars." }] };
test("a workspace's own knowledge base goes into its policy fingerprint and its site file", () => {
  const p = buildPolicy(withKb); const s = buildSite(withKb, "c.testnet");
  assert.ok(p.kb && p.kb.chunks === 2);
  assert.ok(verifyKb(s.kb!.chunks, p.kb!), "the served chunks rebuild the registered root");
  assert.notEqual(policyHash(p), policyHash(buildPolicy(form)));
  assert.notEqual(policyHash(p), policyHash(buildPolicy({ ...withKb, kbDocs: [withKb.kbDocs![0], { title: "Fees", text: "A visit costs 60 dollars." }] })));
});
test("two workspaces keep separate knowledge bases", () => {
  const a = buildPolicy(withKb), b = buildPolicy({ ...withKb, siteId: "other-site", kbDocs: [{ title: "Menu", text: "Soup and bread." }] });
  assert.notEqual(a.kb!.root, b.kb!.root);
});
test("no knowledge base means no kb in the policy or the file", () => {
  assert.equal(buildPolicy(form).kb, undefined); assert.equal(buildSite(form, "c.testnet").kb, undefined);
  assert.equal(buildPolicy({ ...form, kbDocs: [{ title: "", text: "" }] }).kb, undefined);
});
test("knowledge base problems show up in the form check", () => {
  assert.deepEqual(formProblems(withKb), []);
  assert.ok(formProblems({ ...withKb, kbDocs: [{ title: "", text: "some text" }] }).some((p) => /title/i.test(p)));
});

import { chunkDocuments, kbInfo, passageKey, quantize, verifyKb } from "../src/kb.js";
import { indexStatus } from "../src/site.js";
const vecs = (docs: { title: string; text: string }[], seedShift = 0) => Object.fromEntries(chunkDocuments(docs).map((c, i) => [passageKey(c), quantize(Array.from({ length: 8 }, (_, k) => (k === (i + seedShift) % 8 ? 1 : 0.1)))]));
test("a complete semantic index goes into the policy fingerprint and the served chunks", () => {
  const f = { ...withKb, kbVectors: vecs(withKb.kbDocs!) };
  const p = buildPolicy(f), s = buildSite(f, "c.testnet");
  assert.ok(p.kb!.embed && p.kb!.embed.dims === 8 && p.kb!.embed.model.includes("Embedding"));
  assert.ok(s.kb!.chunks.every((c) => !!c.vec));
  assert.ok(verifyKb(s.kb!.chunks, p.kb!), "the served copy rebuilds the registered root");
  assert.notEqual(policyHash(p), policyHash(buildPolicy(withKb)), "an indexed policy differs from a plain one");
  assert.notEqual(policyHash(p), policyHash(buildPolicy({ ...f, kbVectors: vecs(withKb.kbDocs!, 3) })), "different vectors, different fingerprint");
  assert.deepEqual(indexStatus(f), { total: 2, embedded: 2, complete: true });
});
test("editing a passage drops its vector, and a partial index is never advertised or served", () => {
  const f = { ...withKb, kbVectors: vecs(withKb.kbDocs!) };
  const edited = { ...f, kbDocs: [withKb.kbDocs![0], { title: "Fees", text: "A visit costs 60 dollars." }] };
  assert.deepEqual(indexStatus(edited), { total: 2, embedded: 1, complete: false });
  assert.equal(buildPolicy(edited).kb!.embed, undefined);
  assert.ok(buildSite(edited, "c.testnet").kb!.chunks.every((c) => c.vec === undefined));
  assert.deepEqual(indexStatus({ ...withKb }), { total: 2, embedded: 0, complete: false });
});

test("a sealed knowledge base is registered as sealed, has no vectors, and has a different fingerprint from the public one", () => {
  const sealed = { ...withKb, kbMode: "sealed" as const, kbVectors: vecs(withKb.kbDocs!) };
  const p = buildPolicy(sealed), s = buildSite(sealed, "c.testnet");
  assert.equal(p.kb!.mode, "sealed"); assert.equal(p.kb!.embed, undefined, "even if vectors exist, a sealed knowledge base ignores them");
  assert.ok(s.kb!.chunks.every((c) => c.vec === undefined));
  assert.notEqual(policyHash(p), policyHash(buildPolicy(withKb)));
  assert.equal(p.kb!.root, kbInfo(chunkDocuments(withKb.kbDocs!)).root, "the root is over the plain passages, so an auditor can check them");
  assert.equal(buildPolicy({ ...withKb, kbMode: "public" }).kb!.mode, undefined, "public stays as it always was");
  assert.equal(policyHash(buildPolicy({ ...withKb, kbMode: "public" })), policyHash(buildPolicy(withKb)));
});
