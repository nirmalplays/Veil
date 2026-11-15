// One real run against the live relay, printing only what matters for diagnosis.
import { runFlow } from "../src/flow.js";
const r = await runFlow({ relay: "https://veil-relay-oitl.onrender.com", question: "Hello, are you there?", emit: (e) => { if (["fail", "warn"].includes(e.kind) || e.stage === "send" || e.stage === "decrypt") console.log(e.kind.padEnd(5), e.stage.padEnd(9), e.text.slice(0, 300)); } });
console.log("RESULT ok:", r.ok, "| error:", r.error ?? "-", "| answer:", (r.answer ?? "").slice(0, 160));
