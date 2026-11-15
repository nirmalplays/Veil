// Creates NEAR testnet accounts through the testnet faucet and writes their keys to wallets.local.json (git-ignored).
// Usage (from web/): node scripts/create-wallets.mjs <label> [<label> ...]
import { KeyPair, JsonRpcProvider } from "near-api-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const out = fileURLToPath(new URL("../../wallets.local.json", import.meta.url));
const saved = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
const rpc = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
for (const label of process.argv.slice(2)) {
  if (saved[label]) { console.log(label, "exists:", saved[label].accountId); continue; }
  const kp = KeyPair.fromRandom("ed25519");
  const id = `veil-${label}-${Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, "0")).join("")}.testnet`;
  const r = await fetch("https://helper.nearprotocol.com/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) });
  if (!r.ok) { console.log(label, "faucet refused:", r.status, (await r.text()).slice(0, 200)); continue; }
  let bal = "?";
  for (let i = 0; i < 20; i++) { try { const a = await rpc.query({ request_type: "view_account", finality: "final", account_id: id }); bal = (Number(BigInt(a.amount) / 10n ** 21n) / 1000).toFixed(3); break; } catch { await new Promise((res) => setTimeout(res, 1500)); } }
  saved[label] = { accountId: id, privateKey: kp.toString(), publicKey: kp.getPublicKey().toString(), network: "testnet" };
  writeFileSync(out, JSON.stringify(saved, null, 2));
  console.log(label, "created:", id, "balance:", bal, "NEAR");
}
