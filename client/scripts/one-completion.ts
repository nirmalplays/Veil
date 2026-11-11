// The smallest end-to-end proof, with no UI: pick a TEE-hosted model from the models endpoint, fetch an attestation with a fresh nonce,
// verify it, send ONE end-to-end encrypted completion, and check the response signature.
//
//   cp .env.example .env      (then put your key in it)
//   npm run one-completion
//
// Nothing is written to disk or sent anywhere except NEAR AI Cloud, NVIDIA's attestation service and Intel's collateral service.
import { NearAI, teeChatModels } from "../src/nearai.js";
import { verifyModelAttestation } from "../src/verify.js";
import { makeReceipt, verifyReceipt } from "../src/receipt.js";

const key = process.env.NEARAI_API_KEY;
if (!key) { console.error("Set NEARAI_API_KEY in .env (copy .env.example). Get a key at https://cloud.near.ai."); process.exit(2); }
const ai = new NearAI(key);

// 1. The models endpoint. Only models NEAR AI runs itself are in attested TEEs; the cheapest one keeps this to a fraction of a cent.
const all = await ai.models();
const tee = teeChatModels(all).sort((a, b) => (a.pricing?.output ?? 1e9) - (b.pricing?.output ?? 1e9));
const model = process.argv[2] ?? tee[0]?.id;
if (!model) { console.error("No TEE-hosted chat model found."); process.exit(1); }
console.log(`Models endpoint: ${all.length} models, ${tee.length} TEE-hosted chat models. Using ${model}.`);

// 2. One completion. chatE2EE fetches the attestation with a fresh random nonce and refuses to send anything unless the full check passes.
const messages = [{ role: "user" as const, content: "In one sentence, what does a trusted execution environment protect?" }];
const chat = await ai.chatE2EE(model, messages, { maxTokens: 2500, verify: verifyModelAttestation });
const v = chat.attestation.full!;
console.log(`\nAttestation (fresh nonce ${chat.attestation.nonce.slice(0, 16)}…):`);
for (const c of v.checks) console.log(`  ${c.state === "ok" ? "PASS" : c.state === "skipped" ? "SKIP" : "FAIL"}  ${c.label}`);
console.log(`  Intel TCB status: ${v.tcbStatus}`);

console.log(`\nReply (encrypted to the verified key ${chat.attestation.check.publicKey!.slice(0, 16)}…, decrypted here):\n  ${chat.text.replace(/\n/g, "\n  ")}`);

// 3. The enclave's signature over the exact request and response bytes.
const receipt = await makeReceipt(ai, model, chat);
const r = await verifyReceipt(receipt, { verifyAttestation: verifyModelAttestation });
console.log("\nResponse signature:");
for (const c of r.checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.label}`);
const ok = v.ok && r.ok && !!chat.text;
console.log(ok ? "\nVERIFIED: the answer came from the attested enclave." : "\nNOT VERIFIED.");
process.exit(ok ? 0 : 1);
