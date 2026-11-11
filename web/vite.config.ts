import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const client = fileURLToPath(new URL("../client/src", import.meta.url));
const samples = fileURLToPath(new URL("../samples", import.meta.url));
// Dev only: lets the Workspaces tab write a site file into widget/sites/, which the relay re-reads on each request.
// It needs a custom header, so a page on another origin cannot call it (that would trigger a CORS preflight, which is refused).
const sitesDir = fileURLToPath(new URL("../widget/sites", import.meta.url));
const veilSites = (): Plugin => ({
  name: "veil-sites",
  configureServer(server) {
    server.middlewares.use("/__veil/save-site", (req, res) => {
      const done = (code: number, body: object) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
      if (req.method !== "POST" || req.headers["x-veil"] !== "1") return done(405, { error: "not allowed" });
      let b = ""; req.on("data", (c) => { b += c; if (b.length > 100_000) req.destroy(); });
      req.on("end", () => {
        try {
          const j = JSON.parse(b);
          if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(j.siteId ?? "") || !j.policy?.prompt || !j.model) throw new Error("not a valid site file");
          mkdirSync(sitesDir, { recursive: true }); writeFileSync(`${sitesDir}/${j.siteId}.json`, JSON.stringify(j, null, 2)); done(200, { ok: true });
        } catch (e) { done(400, { error: e instanceof Error ? e.message : "bad request" }); }
      });
    });
  },
});
export default defineConfig({
  plugins: [react(), veilSites()],
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
