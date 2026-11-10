// A site's policy: the master prompt plus rules that can be checked mechanically. The hash registered on NEAR covers both, so a
// receipt can prove "this exact reply obeyed these exact rules" for anything a rule can express. Rules a program cannot check
// (tone, "don't give legal advice") stay in the prompt, and a receipt does not prove those.
import { sha256 } from "@noble/hashes/sha2.js";

export type Rule =
  | { type: "max_words"; n: number }
  | { type: "must_include"; text: string }
  | { type: "must_not_include"; text: string }
  | { type: "must_not_match"; pattern: string; flags?: string; label?: string };
export interface Policy { prompt: string; rules?: Rule[] }
export interface RuleResult { rule: Rule; ok: boolean; label: string; detail: string }

/** Stable JSON: object keys sorted, so the same policy always hashes the same. An empty rule list equals no rules. */
export function canonicalPolicy(p: Policy): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sort(x)])) : v;
  return JSON.stringify(sort({ prompt: p.prompt, rules: p.rules ?? [] }));
}
export const policyHash = (p: Policy): string =>
  Array.from(sha256(new TextEncoder().encode(canonicalPolicy(p))), (b) => b.toString(16).padStart(2, "0")).join("");

export const describeRule = (r: Rule): string => {
  switch (r.type) {
    case "max_words": return `at most ${r.n} words`;
    case "must_include": return `mentions “${r.text}”`;
    case "must_not_include": return `never says “${r.text}”`;
    case "must_not_match": return `contains no ${r.label ?? `match for /${r.pattern}/`}`;
  }
};

/** Runs every rule on a reply. Pure and deterministic, so anyone holding the reply gets the same answer. */
export function checkRules(rules: Rule[] | undefined, reply: string): RuleResult[] {
  return (rules ?? []).map((rule): RuleResult => {
    const label = describeRule(rule);
    const lower = reply.toLowerCase();
    switch (rule.type) {
      case "max_words": {
        const n = reply.trim() ? reply.trim().split(/\s+/).length : 0;
        return { rule, label, ok: n <= rule.n, detail: `${n} words` };
      }
      case "must_include": { const ok = lower.includes(rule.text.toLowerCase()); return { rule, label, ok, detail: ok ? "found" : "missing" }; }
      case "must_not_include": { const ok = !lower.includes(rule.text.toLowerCase()); return { rule, label, ok, detail: ok ? "absent" : "present" }; }
      case "must_not_match": {
        try { const hit = new RegExp(rule.pattern, rule.flags ?? "i").test(reply); return { rule, label, ok: !hit, detail: hit ? "matched" : "no match" }; }
        catch { return { rule, label, ok: false, detail: "invalid pattern" }; }
      }
    }
  });
}
