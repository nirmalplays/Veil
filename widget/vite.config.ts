import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const client = fileURLToPath(new URL("../client/src", import.meta.url));
// Library build: one module (`veil-widget.js`) plus a lazily loaded chunk with the full attestation verifier, fetched only
// when a visitor sends their first message. Embed with <script type="module" src=".../veil-widget.js" data-relay="...">.
export default defineConfig({
  resolve: { alias: { "@client": client } },
  server: { fs: { allow: [".."] } },
  build: { lib: { entry: "src/widget.ts", formats: ["es"], fileName: () => "veil-widget.js" }, target: "es2022" },
  define: { global: "globalThis" },
});
