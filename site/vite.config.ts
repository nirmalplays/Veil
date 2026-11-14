import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Three pages. The client code is imported from ../client/src, so the dev server must be allowed to read it.
export default defineConfig({
  server: { fs: { allow: [".."] } },
  build: { target: "es2022", rollupOptions: { input: { index: here("index.html"), live: here("live.html"), docs: here("docs.html") } } },
  define: { global: "globalThis" },
});
