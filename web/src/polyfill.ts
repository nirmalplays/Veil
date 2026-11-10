// Wallet-selector packages expect a global Buffer.
import { Buffer } from "buffer";
(globalThis as any).Buffer ??= Buffer;
(globalThis as any).process ??= { env: {}, browser: true, version: "", versions: {}, nextTick: (f: () => void) => setTimeout(f, 0) };
