import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const client = fileURLToPath(new URL("../client/src", import.meta.url));
// Library build: ONE self-contained file, `veil-widget.js`, that any website can host. Embed with
// <script defer src=".../veil-widget.js" data-relay="..."></script>
export default defineConfig({
  resolve: { alias: { "@client": client } },
  server: { fs: { allow: [".."] } },
  build: { lib: { entry: "src/widget.ts", formats: ["iife"], name: "VeilWidget", fileName: () => "veil-widget.js" }, target: "es2022", rollupOptions: { output: { inlineDynamicImports: true } } },
  define: { global: "globalThis" },
});
