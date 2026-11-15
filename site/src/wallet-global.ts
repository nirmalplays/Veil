// Entry for veil-wallet.js: the wallet code as its own small script, so the chat widget loads it only when a visitor has to pay.
import * as wallet from "./wallet";
(window as unknown as { VeilWallet: typeof wallet }).VeilWallet = wallet;
