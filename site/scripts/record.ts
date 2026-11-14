// Records one real run of the pipeline against the live relay, for the "Replay a recorded run" button.
// Usage: npm run record -- [relay URL] ["question"]
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runFlow, type FlowEvent } from "../src/flow.js";

const relay = process.argv[2] ?? "https://veil-relay-oitl.onrender.com";
const question = process.argv[3] ?? "Can you tell me how a first consultation works?";
const events: FlowEvent[] = [];
const res = await runFlow({ relay, question, emit: (e) => { events.push(e); console.log(`${(e.t / 1000).toFixed(2).padStart(6)}s ${e.kind.padEnd(4)} ${e.actor.padEnd(7)} ${e.text}`); } });
if (!res.ok) { console.error("run did not complete:", res.error); process.exit(1); }
const out = fileURLToPath(new URL("../public/recorded-run.json", import.meta.url));
// The attestation report inside the receipt is ~800 KB, too heavy for a page asset; a live run gives the full receipt.
const receipt = res.receipt && { ...res.receipt, attestation: { nonce: res.receipt.attestation.nonce, report: "(omitted from the recording: about 800 KB. A live run gives you the full receipt.)" } };
writeFileSync(out, JSON.stringify({ recordedAt: new Date().toISOString(), relay, question, answer: res.answer, receipt, events }));
console.log(`\nSaved ${events.length} events to public/recorded-run.json`);
