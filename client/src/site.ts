// A workspace is one site's AI: its identity, greeting, policy (prompt plus checkable rules) and a few settings. These pure helpers
// turn the form in the app into the policy whose hash is registered on NEAR, and into the file the relay serves to the widget.
import type { Policy, Rule } from "./policy.js";
import { chunkDocuments, kbInfo, kbProblems, passageKey, withVectors, type KbChunk, type KbDoc, type KbMode } from "./kb.js";

export interface SiteForm {
  siteId: string; title: string; greeting: string; fallback: string; model: string; receipts: "off" | "visitor";
  prompt: string; maxWords: number | null; mustMention: string[]; mustNeverSay: string[]; presets: string[];
  /** This workspace's own knowledge base. Optional: with none, the assistant answers from its instructions alone. */
  kbDocs?: KbDoc[];
  /** Vectors for its passages, computed in the TEE and keyed by passageKey. Used only if every passage has one. */
  kbVectors?: Record<string, string>;
  /** "public": passages are served to visitors' browsers, searched there, and verifiable. "sealed": never served, read only inside the enclave. Default public. */
  kbMode?: KbMode;
}
export interface SiteFile {
  siteId: string; title: string; greeting: string; fallback: string; policy: Policy; model: string; contract: string;
  receipts: "off" | "visitor"; maxTokens: number; ratePerMinute: number;
  /** Chunks of the knowledge base, served to the widget, which accepts them only if they rebuild the root in the registered policy. */
  kb?: { chunks: KbChunk[] };
}

export const PRESETS: Record<string, { label: string; rule: Rule }> = {
  ssn: { label: "No social security numbers", rule: { type: "must_not_match", pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b", label: "social security number" } },
  card: { label: "No payment card numbers", rule: { type: "must_not_match", pattern: "\\b(?:\\d[ -]?){13,16}\\b", label: "payment card number" } },
  email: { label: "No email addresses", rule: { type: "must_not_match", pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.-]+", label: "email address" } },
};

/** Null when fine. Ids end up in URLs and file names, so they stay simple. */
export const validateSiteId = (id: string): string | null =>
  /^[a-z0-9][a-z0-9-]{1,40}$/.test(id) ? null : "Use 2 to 41 lowercase letters, digits or dashes, starting with a letter or digit.";

const clean = (xs: string[]): string[] => {
  const seen = new Set<string>(); const out: string[] = [];
  for (const x of xs.map((t) => t.trim()).filter(Boolean)) if (!seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); out.push(x); }
  return out;
};

/** Rule order is fixed (words, must mention, must never say, presets) so the same form always gives the same hash. */
export function buildPolicy(f: SiteForm): Policy {
  const rules: Rule[] = [];
  if (f.maxWords && f.maxWords > 0) rules.push({ type: "max_words", n: Math.floor(f.maxWords) });
  for (const t of clean(f.mustMention)) rules.push({ type: "must_include", text: t });
  for (const t of clean(f.mustNeverSay)) rules.push({ type: "must_not_include", text: t });
  for (const id of f.presets) if (PRESETS[id]) rules.push(PRESETS[id].rule);
  const chunks = buildChunks(f);
  return { prompt: f.prompt.trim(), rules, ...(chunks.length ? { kb: kbInfo(chunks, undefined, f.kbMode ?? "public") } : {}) };
}

/** The passages as they will be registered and served: chunked, with vectors attached only if the index is complete (and never for a sealed knowledge base, which has none). */
export const buildChunks = (f: SiteForm): KbChunk[] => (f.kbMode === "sealed" ? chunkDocuments(f.kbDocs ?? []) : withVectors(chunkDocuments(f.kbDocs ?? []), f.kbVectors));
/** How much of the knowledge base has a vector, for the app to show. */
export function indexStatus(f: SiteForm): { total: number; embedded: number; complete: boolean } {
  const chunks = chunkDocuments(f.kbDocs ?? []); const embedded = chunks.filter((c) => !!f.kbVectors?.[passageKey(c)]).length;
  return { total: chunks.length, embedded, complete: chunks.length > 0 && embedded === chunks.length };
}

export function formProblems(f: SiteForm): string[] {
  const p: string[] = [];
  const id = validateSiteId(f.siteId); if (id) p.push(`Site id: ${id}`);
  if (!f.title.trim()) p.push("Give the assistant a name to show in the chat header.");
  if (!f.greeting.trim()) p.push("Write a greeting.");
  if (!f.prompt.trim()) p.push("Write the instructions (the master prompt).");
  if (f.maxWords !== null && !(f.maxWords > 0)) p.push("Max words must be a positive number, or left empty.");
  if ((f.kbDocs ?? []).some((d) => d.text.trim())) p.push(...kbProblems(f.kbDocs!));
  return p;
}

export const buildSite = (f: SiteForm, contract: string): SiteFile => ({
  siteId: f.siteId, title: f.title.trim(), greeting: f.greeting.trim(), fallback: f.fallback.trim() || "I can't answer that here. Please contact us directly.",
  policy: buildPolicy(f), model: f.model, contract, receipts: f.receipts, maxTokens: 3000, ratePerMinute: 20,
  ...((f.kbDocs ?? []).some((d) => d.text.trim()) ? { kb: { chunks: buildChunks(f) } } : {}),
});
