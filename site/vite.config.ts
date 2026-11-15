import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Three pages. The home page is a React app built with ReactBits components; live and docs stay plain TypeScript.
// The client code is imported from ../client/src, so the dev server must be allowed to read it.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [".."] } },
  build: { target: "es2022", chunkSizeWarningLimit: 900, rollupOptions: { input: { index: here("index.html"), live: here("live.html"), docs: here("docs.html") } } },
  define: { global: "globalThis" },
});
