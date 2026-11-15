// Pay per question with a NEAR wallet. Shared by the live page and the chat widget.
// The relay answers "402 payment required" once a visitor's free questions are used up, with where and how much to pay. This module connects
// the visitor's wallet (Meteor: browser extension or web wallet), asks it to send that transfer, and returns "<tx hash>:<account>",
// which the browser sends back in the X-Veil-Payment header. The relay checks the transfer on NEAR itself before answering.
import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { actionCreators } from "@near-js/transactions";
import modalCss from "@near-wallet-selector/modal-ui/styles.css?inline";

let styled = false;
const style = () => { if (styled) return; styled = true; const el = document.createElement("style"); el.textContent = `${modalCss} #near-wallet-selector-modal .nws-modal-wrapper{z-index:2147483646}`; document.head.appendChild(el); };

export interface PayInfo { payTo: string; priceNear: string; priceYocto: string; network: string; freePerDay?: number; freeLeft?: number }

let selector: WalletSelector | undefined, net = "";
async function sel(network = "testnet") {
  if (!selector || net !== network) { selector = await setupWalletSelector({ network: network as "testnet" | "mainnet", modules: [setupMeteorWallet()] }); net = network; }
  return selector;
}
const active = (s: WalletSelector) => s.store.getState().accounts.find((a) => a.active)?.accountId ?? s.store.getState().accounts[0]?.accountId;

/** The connected account, if any. */
export async function connectedAccount(network = "testnet"): Promise<string | undefined> { return active(await sel(network)); }
/** Calls back whenever the connected account changes. */
export async function onAccount(cb: (id: string | undefined) => void, network = "testnet") {
  const s = await sel(network); cb(active(s)); s.store.observable.subscribe(() => cb(active(s)));
}

/** Opens the wallet picker and resolves once an account is connected (or rejects if the picker is closed). */
export async function connect(network = "testnet"): Promise<string> {
  const s = await sel(network);
  const now = active(s); if (now) return now;
  style();
  const modal = setupModal(s, { contractId: "" });
  return new Promise((ok, no) => {
    const sub = s.store.observable.subscribe(() => { const a = active(s); if (a) { sub.unsubscribe(); modal.hide(); ok(a); } });
    modal.on("onHide", ({ hideReason }) => { if (hideReason === "user-triggered" && !active(s)) { sub.unsubscribe(); no(new Error("no wallet connected")); } });
    modal.show();
  });
}
export async function disconnect(network = "testnet") { const s = await sel(network); if (active(s)) await (await s.wallet()).signOut(); }

/** Sends the site's price to the site's account and returns the payment header the relay expects. */
export async function pay(info: PayInfo): Promise<string> {
  const account = await connect(info.network);
  const s = await sel(info.network);
  const w = await s.wallet();
  const out: any = await w.signAndSendTransaction({ signerId: account, receiverId: info.payTo, actions: [actionCreators.transfer(BigInt(info.priceYocto))] });
  const hash = out?.transaction?.hash ?? out?.transaction_outcome?.id;
  if (!hash) throw new Error("the wallet did not return a transaction");
  return `${hash}:${account}`;
}
