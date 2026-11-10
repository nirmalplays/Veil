import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const client = fileURLToPath(new URL("../client/src", import.meta.url));
const samples = fileURLToPath(new URL("../samples", import.meta.url));
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@client": client, "@samples": samples, buffer: "buffer/" } },
  server: {
    fs: { allow: [".."] },
    // NVIDIA's attestation service refuses browser CORS preflights, so its POST goes through this same-origin proxy.
    // It cannot forge a verdict: the signed token is checked in the browser against NVIDIA's own keys.
    proxy: { "/nras": { target: "https://nras.attestation.nvidia.com", changeOrigin: true, rewrite: (p) => p.replace(/^\/nras/, ""),
      // NVIDIA answers 403 to requests that carry a browser Origin, so the proxy strips it.
      configure: (proxy) => proxy.on("proxyReq", (req) => { req.removeHeader("origin"); req.removeHeader("referer"); }) } },
  },
  define: { global: "globalThis" },
});
