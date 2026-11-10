// Usage: NEARAI_API_KEY=... npx tsx scripts/make-receipt.ts [out.json] ["question"]
// One real E2EE completion under a policy, with a verifiable receipt written to disk and checked at once.
import { writeFileSync } from "node:fs";
import { NearAI } from "../src/nearai.js";
import { makeReceipt, verifyReceipt } from "../src/receipt.js";
import type { Policy } from "../src/policy.js";
import { verifyModelAttestation } from "../src/verify.js";
const key = process.env.NEARAI_API_KEY;
if (!key) { console.error("Set NEARAI_API_KEY (from https://cloud.near.ai)."); process.exit(2); }
const out = process.argv[2] ?? "receipt.json";
const question = process.argv[3] ?? "Can I sue my landlord for keeping my deposit?";
const model = "z-ai/glm-5.3-flash";
const policy: Policy = {
  prompt: "You are the intake assistant for a law firm. Never give legal advice. Always say you are an AI and suggest booking a consultation. Keep answers under 60 words.",
  rules: [{ type: "max_words", n: 80 }, { type: "must_include", text: "AI" }, { type: "must_not_include", text: "guarantee" },
    { type: "must_not_match", pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b", label: "social security number" }],
};
const messages = [{ role: "system" as const, content: policy.prompt }, { role: "user" as const, content: question }];
const ai = new NearAI(key);
const chat = await ai.chatE2EE(model, messages, { maxTokens: 2500, verify: verifyModelAttestation });
const receipt = await makeReceipt(ai, model, chat, { policy, disclose: { messages, reply: chat.text } });
writeFileSync(out, JSON.stringify(receipt, null, 2));
console.log(`Q: ${question}\nA: ${chat.text}\n`);
const r = await verifyReceipt(receipt, { verifyAttestation: verifyModelAttestation, policy });
for (const c of r.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.label}\n      ${c.detail}`);
console.log(`\nRules (${r.compliance.againstRegistry ? "policy matches the registered hash" : "not compared with a registry"}):`);
for (const x of r.compliance.results) console.log(`${x.ok ? "OBEYED" : "BROKEN"}  ${x.label}  (${x.detail})`);
console.log(r.ok ? `\nRECEIPT VERIFIED -> ${out}` : "\nRECEIPT INVALID");
process.exit(r.ok ? 0 : 1);
