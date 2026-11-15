// Two real questions against a relay that charges after one free question; pays from wallets.local.json's "you" wallet on testnet.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runFlow } from "../src/flow.js";
const relay = process.argv[2] ?? "http://127.0.0.1:8791";
const web = fileURLToPath(new URL("../../web/", import.meta.url));
for (const q of ["Do you handle tenant cases?", "And employment disputes?"]) {
  const r = await runFlow({ relay, question: q,
    emit: (e) => { if (e.stage === "send" || e.kind === "fail") console.log("  ", e.kind.padEnd(4), e.text.slice(0, 140)); },
    pay: async (info) => { console.log("   paying", info.priceNear, "NEAR to", info.payTo); return execFileSync("node", ["scripts/pay-once.mjs", "you", info.payTo, info.priceNear], { cwd: web }).toString().trim().split("\n").pop()!; } });
  console.log(`Q: ${q}\n   ok=${r.ok} ${r.error ?? ""} answer: ${(r.answer ?? "").slice(0, 100)}`);
}
