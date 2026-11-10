// Usage: NEARAI_API_KEY=... npx tsx scripts/memory-demo.ts
// Asks the same question twice through the real enclave: once with no memory, once with a consented session retrieved as context.
import { NearAI } from "../src/nearai.js";
import { buildMemoryPrompt, rank } from "../src/memory.js";
import { verifyModelAttestation } from "../src/verify.js";
const key = process.env.NEARAI_API_KEY;
if (!key) { console.error("Set NEARAI_API_KEY (from https://cloud.near.ai)."); process.exit(2); }
const model = "z-ai/glm-5.3-flash";
const sessions = [
  { id: "s1", text: "user: our staging deploy keeps failing on the Bluefin pipeline\nassistant: the Bluefin pipeline needs the REGION_LOCK=eu-3 variable set before the migrate step, otherwise it times out." },
  { id: "s2", text: "user: what should I cook tonight\nassistant: pasta with garlic and olive oil." },
];
const question = "Our Bluefin pipeline deploy is timing out at the migrate step. What should I check?";
const ai = new NearAI(key);
const ask = async (msgs: { role: "system" | "user"; content: string }[]) => (await ai.chatE2EE(model, msgs, { maxTokens: 2500, verify: verifyModelAttestation })).text;
console.log("Q:", question, "\n");
console.log("WITHOUT memory:\n" + (await ask([{ role: "user", content: question }])) + "\n");
const hits = rank(question, sessions, 3);
console.log("Retrieved:", hits.map((h) => h.id).join(", ") || "none", `(of ${sessions.length} consented sessions; only relevant ones are sent)\n`);
const withMem = await ask([{ role: "system", content: buildMemoryPrompt(hits) }, { role: "user", content: question }]);
console.log("WITH consented memory:\n" + withMem + "\n");
console.log(/REGION_LOCK/i.test(withMem) ? "RESULT: the answer used the consented session (it names REGION_LOCK=eu-3)." : "RESULT: the answer did not use the session.");
process.exit(/REGION_LOCK/i.test(withMem) ? 0 : 1);
