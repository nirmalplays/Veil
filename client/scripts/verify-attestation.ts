// Usage: NEARAI_API_KEY=... npx tsx scripts/verify-attestation.ts [model]
// Fetches a fresh attestation (free, no credits used) and runs every check. Exit code 1 if any check fails.
import { NearAI } from "../src/nearai.js";
import { verifyModelAttestation } from "../src/verify.js";

const key = process.env.NEARAI_API_KEY;
if (!key) { console.error("Set NEARAI_API_KEY (from https://cloud.near.ai)."); process.exit(2); }
const model = process.argv[2] ?? "z-ai/glm-5.3-flash";
const { nonce, report } = await new NearAI(key).attestation(model);
console.log(`Model ${model}\nNonce ${nonce}\n`);
const r = await verifyModelAttestation(report, nonce);
for (const c of r.checks) console.log(`${c.state === "ok" ? "PASS" : c.state === "skipped" ? "SKIP" : "FAIL"}  ${c.label}\n      ${c.detail}`);
console.log(`\nIntel TCB status: ${r.tcbStatus ?? "n/a"}${r.advisoryIds?.length ? ", advisories " + r.advisoryIds.join(",") : ""}`);
console.log(r.ok ? `\nVERIFIED. Pin this model key: ${r.publicKey}` : "\nNOT VERIFIED.");
process.exit(r.ok ? 0 : 1);
