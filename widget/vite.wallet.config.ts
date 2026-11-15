import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Builds veil-wallet.js, loaded by the widget on demand when a visitor pays per question.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: { entry: fileURLToPath(new URL("../site/src/wallet-global.ts", import.meta.url)), formats: ["iife"], name: "VeilWalletBundle", fileName: () => "veil-wallet.js" },
    target: "es2022", rollupOptions: { output: { inlineDynamicImports: true } },
  },
  define: { global: "globalThis", "process.env.NODE_ENV": '"production"' },
});
