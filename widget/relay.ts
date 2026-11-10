// Relay for the Veil widget. A website cannot hold a NEAR AI API key in browser code, so this small server does, and only forwards.
// The visitor's browser encrypts every message straight to the attested enclave (E2EE), so the relay and the site owner see
// ciphertext, never the conversation. To keep that true the relay refuses any chat request that is not E2EE, and it never
// rewrites a body (the enclave signs a hash of the exact bytes, and receipts depend on it).
//
// Usage: NEARAI_API_KEY=... npx tsx relay.ts [site.json]
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { policyHash, type Policy } from "../client/src/policy.js";

export interface Site {
  siteId: string; title: string; greeting: string;
  /** Master prompt plus mechanically checkable rules. Public by design: visitors check its hash against the registry on NEAR. */
  policy: Policy;
  /** Shown instead of a reply that broke a rule. */
  fallback?: string;
  model: string; contract: string;
  /** "visitor" lets visitors opt in to receipts; "off" hides them. */
  receipts: "off" | "visitor";
  allowedOrigins?: string[]; maxTokens?: number; ratePerMinute?: number;
}

const KEY = process.env.NEARAI_API_KEY;
if (!KEY) { console.error("Set NEARAI_API_KEY (from https://cloud.near.ai). It stays on this server."); process.exit(2); }
const siteFile = process.argv[2] ?? new URL("./demo/site.json", import.meta.url).pathname;
const site: Site = JSON.parse(readFileSync(siteFile, "utf8"));
const MAX = site.maxTokens ?? 3000, RATE = site.ratePerMinute ?? 20, PORT = Number(process.env.PORT ?? 8790);
const UPSTREAM = process.env.NEARAI_BASE ?? "https://cloud-api.near.ai";
const NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";

const hits = new Map<string, number[]>();
const limited = (ip: string) => {
  const now = Date.now(), a = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  a.push(now); hits.set(ip, a); return a.length > RATE;
};
const readBody = (req: IncomingMessage, max = 256 * 1024) => new Promise<string>((ok, no) => {
  let n = 0; const c: Buffer[] = [];
  req.on("data", (d: Buffer) => { n += d.length; if (n > max) { no(new Error("body too large")); req.destroy(); } else c.push(d); });
  req.on("end", () => ok(Buffer.concat(c).toString("utf8"))); req.on("error", no);
});

createServer(async (req, res) => {
  const origin = req.headers.origin;
  const originOk = !site.allowedOrigins?.length || (!!origin && site.allowedOrigins.includes(origin));
  const send = (code: number, body: string, type = "application/json") => {
    res.writeHead(code, { "Content-Type": type, ...(origin && originOk ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}) }).end(body);
  };
  const err = (code: number, msg: string) => send(code, JSON.stringify({ error: msg }));
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(originOk ? 204 : 403, { ...(origin && originOk ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "600",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Signing-Algo, X-Client-Pub-Key, X-Model-Pub-Key, X-Encryption-Version, x-no-aliasing" }).end();
      return;
    }
    if (!originOk) return err(403, "origin not allowed");
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const ip = req.socket.remoteAddress ?? "?";

    if (req.method === "GET" && url.pathname === "/config") {
      const { allowedOrigins, maxTokens, ratePerMinute, ...pub } = site; void allowedOrigins; void ratePerMinute;
      return send(200, JSON.stringify({ ...pub, maxTokens: MAX }));
    }
    if (req.method === "GET" && url.pathname === "/v1/attestation/report") {
      if (url.searchParams.get("model") !== site.model) return err(403, "model not allowed");
      const r = await fetch(UPSTREAM + "/v1/attestation/report" + url.search, { headers: { Authorization: `Bearer ${KEY}` } });
      return send(r.status, await r.text());
    }
    const sig = /^\/v1\/signature\/([A-Za-z0-9_-]{8,80})$/.exec(url.pathname);
    if (req.method === "GET" && sig) {
      if (url.searchParams.get("model") !== site.model) return err(403, "model not allowed");
      const r = await fetch(UPSTREAM + url.pathname + url.search, { headers: { Authorization: `Bearer ${KEY}` } });
      return send(r.status, await r.text());
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      if (limited(ip)) return err(429, "slow down");
      const body = await readBody(req);
      let j: any; try { j = JSON.parse(body); } catch { return err(400, "bad json"); }
      if (j.model !== site.model) return err(403, "model not allowed");
      if (req.headers["x-encryption-version"] !== "2" || !req.headers["x-client-pub-key"] || !req.headers["x-model-pub-key"]) return err(400, "end-to-end encryption required");
      if (j.stream === true) return err(400, "streaming not supported");
      if (typeof j.max_tokens !== "number" || j.max_tokens > MAX) return err(400, `max_tokens required and at most ${MAX}`);
      const h: Record<string, string> = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
      for (const k of ["x-signing-algo", "x-client-pub-key", "x-model-pub-key", "x-encryption-version", "x-no-aliasing"]) { const v = req.headers[k]; if (typeof v === "string") h[k] = v; }
      const r = await fetch(UPSTREAM + "/v1/chat/completions", { method: "POST", headers: h, body });   // body forwarded byte for byte
      return send(r.status, await r.text());
    }
    if (req.method === "POST" && url.pathname === "/nras/v3/attest/gpu") {
      if (limited(ip)) return err(429, "slow down");
      // NVIDIA refuses browser CORS preflights, so the browser posts here. The verdict is a signed token the browser checks itself.
      const r = await fetch(NRAS, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: await readBody(req, 2 * 1024 * 1024) });
      return send(r.status, await r.text());
    }
    return err(404, "not found");
  } catch (e) { return err(500, String(e instanceof Error ? e.message : e)); }
}).listen(PORT, () => {
  const h = policyHash(site.policy);
  console.log(`Veil relay for "${site.siteId}" on http://localhost:${PORT}  (model ${site.model}, max ${MAX} tokens, ${RATE}/min per IP)`);
  console.log(`Policy sha256: ${h}`);
  console.log(`Register it (as the site owner):\n  near contract call-function as-transaction ${site.contract} publish_policy json-args '{"site_id":"${site.siteId}","policy_hash":"${h}","uri":""}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as <you>.testnet network-config testnet sign-with-legacy-keychain send`);
});
