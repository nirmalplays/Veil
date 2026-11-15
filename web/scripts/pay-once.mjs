// Sends one NEAR testnet transfer from a wallet in wallets.local.json and prints "<tx hash>:<signer>". Usage: node scripts/pay-once.mjs <from-label> <to-account> <amount NEAR>
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { readFileSync } from "node:fs";
const [, , from, to, amount] = process.argv;
const w = JSON.parse(readFileSync(new URL("../../wallets.local.json", import.meta.url), "utf8"))[from];
const acct = new Account(w.accountId, new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" }), new KeyPairSigner(KeyPair.fromString(w.privateKey)));
const yocto = (BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 18n).toString();
const r = await acct.transfer({ receiverId: to, amount: yocto });
console.log(`${r.transaction.hash}:${w.accountId}`);
