// Relay for the Veil widget. A website cannot hold a NEAR AI API key in browser code, so this small server does, and only forwards.
// The visitor's browser encrypts every message straight to the attested enclave (E2EE), so the relay and the site owner see
// ciphertext, never the conversation. To keep that true the relay refuses any chat request that is not E2EE, and it never
// rewrites a body (the enclave signs a hash of the exact bytes, and receipts depend on it).
//
// One relay serves many workspaces. Each site file (demo/site.json, and every *.json in sites/) is reachable at /s/<siteId>/..., and the
// first one also answers on the bare paths. Files are re-read on every request, so a workspace saved from the app works at once.
//
// Usage: NEARAI_API_KEY=... npx tsx relay.ts [site.json | folder]
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { policyHash, type Policy } from "../client/src/policy.js";
import { sealKnowledgeBase } from "../client/src/seal.js";
import { verifyModelAttestation } from "../client/src/verify.js";

export interface Site {
  siteId: string; title: string; greeting: string;
  /** Master prompt plus mechanically checkable rules. Public by design: visitors check its hash against the registry on NEAR. */
  policy: Policy;
  /** Shown instead of a reply that broke a rule. */
  fallback?: string;
  /** This site's own knowledge base. Its Merkle root is inside `policy.kb`, so the widget can tell if it was altered. */
  kb?: { chunks: { title: string; text: string }[] };
  model: string; contract: string;
  /** "visitor" lets visitors opt in to receipts; "off" hides them. */
  receipts: "off" | "visitor";
  allowedOrigins?: string[]; maxTokens?: number; ratePerMinute?: number;
}

const KEY = process.env.NEARAI_API_KEY;
if (!KEY) { console.error("Set NEARAI_API_KEY (from https://cloud.near.ai). It stays on this server."); process.exit(2); }
const here = (p: string) => new URL(p, import.meta.url).pathname;
const arg = process.argv[2];
const readSites = (): Site[] => {
  const files: string[] = [];
  const addDir = (d: string) => { if (existsSync(d)) for (const f of readdirSync(d).sort()) if (f.endsWith(".json")) files.push(`${d}/${f}`); };
  if (arg && existsSync(arg) && statSync(arg).isDirectory()) addDir(arg);
  else if (arg) files.push(arg);
  else { files.push(here("./demo/site.json")); addDir(here("./sites")); }
  const out: Site[] = [];
  for (const f of files) { try { const j = JSON.parse(readFileSync(f, "utf8")) as Site; if (j.siteId && j.policy?.prompt && j.model) out.push(j); } catch { /* skip a half-written file */ } }
  return out;
};
const PORT = Number(process.env.PORT ?? 8790);
const NO_SITE = Symbol("no site");

// ---- sealed knowledge bases ----
// SEAL_SECRET makes sealing reproducible, so an owner can later audit what was sealed. Without it a random one is used and audits do not survive a restart.
const SEAL_SECRET = process.env.SEAL_SECRET ?? randomBytes(32).toString("hex");
const AUDIT_TOKEN = process.env.AUDIT_TOKEN;   // optional; without it the audit route is off
/** Enclave keys this relay has verified itself (Intel TDX and NVIDIA GPUs), per model, for ten minutes. A knowledge base is sealed only to such a key. */
const verifiedKeys = new Map<string, number>();
async function enclaveKeyIsGenuine(model: string, modelKey: string): Promise<boolean> {
  const id = `${model}|${modelKey}`, seen = verifiedKeys.get(id);
  if (seen && Date.now() - seen < 10 * 60_000) return true;
  const nonce = randomBytes(32).toString("hex");
  const q = new URLSearchParams({ model, nonce, signing_algo: "ed25519", provider: "near", include_tls_fingerprint: "false" });
  const r = await fetch(`${UPSTREAM}/v1/attestation/report?${q}`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!r.ok) return false;
  const v = await verifyModelAttestation(await r.json(), nonce);
  const ok = v.ok && !!v.publicKey && v.publicKey.toLowerCase() === modelKey.toLowerCase();
  if (ok) verifiedKeys.set(id, Date.now());
  return ok;
}
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const UPSTREAM = process.env.NEARAI_BASE ?? "https://cloud-api.near.ai";
const NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";

// ---- running inside a TEE (dstack) ----
const DSTACK_SOCK = process.env.DSTACK_SOCKET ?? "/var/run/dstack.sock";
/** Where the code running here comes from, so a verifier knows what the attested compose hash should be built from. */
const SOURCE = process.env.VEIL_SOURCE ?? null;
const dstack = (path: string, body: unknown) => new Promise<unknown>((ok, no) => {
  const r = httpRequest({ socketPath: DSTACK_SOCK, path, method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
    const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d));
    res.on("end", () => { try { ok(JSON.parse(Buffer.concat(c).toString("utf8"))); } catch (e) { no(e); } });
  });
  r.on("error", no); r.end(JSON.stringify(body ?? {}));
});

const hits = new Map<string, number[]>();
const limited = (ip: string, rate = 20) => {
  const now = Date.now(), a = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  a.push(now); hits.set(ip, a); return a.length > rate;
};
const readBody = (req: IncomingMessage, max = 256 * 1024) => new Promise<string>((ok, no) => {
  let n = 0; const c: Buffer[] = [];
  req.on("data", (d: Buffer) => { n += d.length; if (n > max) { no(new Error("body too large")); req.destroy(); } else c.push(d); });
  req.on("end", () => ok(Buffer.concat(c).toString("utf8"))); req.on("error", no);
});

createServer(async (req, res) => {
  const origin = req.headers.origin;
  // pick the workspace: /s/<siteId>/... or, on bare paths, the first one
  const rawUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const m = /^\/s\/([a-z0-9-]{2,41})(\/.*)?$/.exec(rawUrl.pathname);
  const all = readSites();
  const chosen: Site | undefined = m ? all.find((x) => x.siteId === m[1]) : all[0];
  if (m) rawUrl.pathname = m[2] ?? "/";
  const site = chosen ?? (NO_SITE as unknown as Site);
  const MAX = site.maxTokens ?? 3000, RATE = site.ratePerMinute ?? 20;
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
    // Proof of where this relay runs. Inside a dstack TEE (Phala Cloud) the guest agent signs a fresh Intel TDX quote that
    // carries the caller's nonce, so a visitor can check the relay holding the API key and seal secret is the published code in an enclave.
    if (req.method === "GET" && rawUrl.pathname === "/relay-attestation") {
      const nonce = rawUrl.searchParams.get("nonce") ?? "";
      if (!/^[0-9a-f]{64}$/.test(nonce)) return err(400, "nonce must be 64 hex characters");
      if (!existsSync(DSTACK_SOCK)) return err(501, "this relay is not running inside a TEE (no dstack socket), so there is nothing to attest");
      const [quote, info] = await Promise.all([
        dstack("/GetQuote", { report_data: nonce }),
        dstack("/Info", undefined),
      ]);
      return send(200, JSON.stringify({ nonce, quote, info, source: SOURCE }));
    }
    if (!chosen) return err(404, "unknown site");
    if (!originOk) return err(403, "origin not allowed");
    const url = rawUrl;
    const ip = req.socket.remoteAddress ?? "?";

    if (req.method === "GET" && url.pathname === "/config") {
      const { allowedOrigins, maxTokens, ratePerMinute, kb, ...pub } = site; void allowedOrigins; void ratePerMinute;
      return send(200, JSON.stringify({ ...pub, maxTokens: MAX, hasKb: !!kb }));
    }
    const sealedKb = site.policy.kb?.mode === "sealed" && !!site.kb?.chunks?.length;
    if (req.method === "GET" && url.pathname === "/kb") {
      if (sealedKb) return err(404, "this knowledge base is sealed and is never served");
      return site.kb?.chunks?.length ? send(200, JSON.stringify({ chunks: site.kb.chunks })) : err(404, "this site has no knowledge base");
    }
    if (req.method === "POST" && url.pathname === "/seal") {
      // Seals the knowledge base to an enclave key for the visitor's browser to forward. Never to a key the caller merely names: only to one this
      // relay has just verified as a genuine enclave for this site's model, otherwise a visitor could ask for it sealed to their own key and read it.
      if (!sealedKb) return err(404, "this site has no sealed knowledge base");
      if (limited(ip, RATE)) return err(429, "slow down");
      let j: any; try { j = JSON.parse(await readBody(req, 4096)); } catch { return err(400, "bad json"); }
      if (typeof j.modelKey !== "string" || !/^[0-9a-f]{64}$/i.test(j.modelKey)) return err(400, "modelKey must be 64 hex characters");
      if (!(await enclaveKeyIsGenuine(site.model, j.modelKey))) return err(403, "that key is not a verified enclave key for this site's model");
      return send(200, JSON.stringify({ content: sealKnowledgeBase({ chunks: site.kb!.chunks, modelKey: j.modelKey.toLowerCase(), secret: SEAL_SECRET + "|" + site.siteId }).content }));
    }
    if (req.method === "POST" && url.pathname === "/audit") {
      // For the site owner: reproduces the secret behind a sealed message so a third party can check what was sealed.
      if (!sealedKb || !AUDIT_TOKEN) return err(404, "no audit available");
      if (!safeEq(String(req.headers.authorization ?? ""), `Bearer ${AUDIT_TOKEN}`)) return err(401, "not authorised");
      let j: any; try { j = JSON.parse(await readBody(req, 4096)); } catch { return err(400, "bad json"); }
      if (typeof j.modelKey !== "string" || !/^[0-9a-f]{64}$/i.test(j.modelKey)) return err(400, "modelKey must be 64 hex characters");
      const s = sealKnowledgeBase({ chunks: site.kb!.chunks, modelKey: j.modelKey.toLowerCase(), secret: SEAL_SECRET + "|" + site.siteId });
      return send(200, JSON.stringify({ content: s.content, ephemeralSecret: s.ephemeralSecret, chunks: site.kb!.chunks }));
    }
    // The chat model, and (if the site has a semantic knowledge base) the embedding model it names, are the only two this site may use.
    const embedModel = site.policy.kb?.embed?.model;
    if (req.method === "GET" && url.pathname === "/v1/attestation/report") {
      const asked = url.searchParams.get("model");
      if (asked !== site.model && !(embedModel && asked === embedModel)) return err(403, "model not allowed");
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
      if (limited(ip, RATE)) return err(429, "slow down");
      const body = await readBody(req, sealedKb ? 2 * 1024 * 1024 : 256 * 1024);   // a sealed knowledge base rides inside every request
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
    if (req.method === "POST" && url.pathname === "/v1/embeddings") {
      // Embeds a visitor's question inside the attested embedding enclave. Like chat, it must be end-to-end encrypted, so this relay never sees the question.
      if (!embedModel) return err(404, "this site has no semantic knowledge base");
      if (limited(ip, RATE)) return err(429, "slow down");
      const body = await readBody(req);
      let j: any; try { j = JSON.parse(body); } catch { return err(400, "bad json"); }
      if (j.model !== embedModel) return err(403, "model not allowed");
      if (req.headers["x-encryption-version"] !== "2" || !req.headers["x-client-pub-key"] || !req.headers["x-model-pub-key"]) return err(400, "end-to-end encryption required");
      if (!Array.isArray(j.input) || j.input.length < 1 || j.input.length > 32 || j.input.some((x: unknown) => typeof x !== "string" || !/^[0-9a-f]+$/i.test(x) || x.length > 40_000)) return err(400, "input must be 1 to 32 encrypted strings");
      const h: Record<string, string> = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
      for (const k of ["x-signing-algo", "x-client-pub-key", "x-model-pub-key", "x-encryption-version", "x-no-aliasing"]) { const v = req.headers[k]; if (typeof v === "string") h[k] = v; }
      const r = await fetch(UPSTREAM + "/v1/embeddings", { method: "POST", headers: h, body });
      return send(r.status, await r.text());
    }
    if (req.method === "POST" && url.pathname === "/nras/v3/attest/gpu") {
      if (limited(ip, RATE)) return err(429, "slow down");
      // NVIDIA refuses browser CORS preflights, so the browser posts here. The verdict is a signed token the browser checks itself.
      const r = await fetch(NRAS, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: await readBody(req, 2 * 1024 * 1024) });
      return send(r.status, await r.text());
    }
    return err(404, "not found");
  } catch (e) { return err(500, String(e instanceof Error ? e.message : e)); }
}).listen(PORT, () => {
  const all = readSites();
  console.log(`Veil relay on http://localhost:${PORT} serving ${all.length} site(s). New files in widget/sites/ are picked up without a restart.`);
  for (const x of all) {
    const h = policyHash(x.policy);
    console.log(`  /s/${x.siteId}  (${x.title}, model ${x.model})  policy sha256 ${h}`);
  }
  console.log("Each site's policy must be registered on NEAR by its owner, or the widget switches itself off (the app's Workspaces tab does this).");
  if (all.some((x) => x.policy.kb?.mode === "sealed")) {
    console.log(process.env.SEAL_SECRET ? "Sealed knowledge bases: SEAL_SECRET is set, so audits keep working across restarts." : "Sealed knowledge bases: SEAL_SECRET is not set, so a random one is used and audits will not survive a restart. Set it in .env.");
    console.log(AUDIT_TOKEN ? "Audit route is on (POST /s/<site>/audit with the AUDIT_TOKEN)." : "Audit route is off. Set AUDIT_TOKEN in .env to let the owner audit a sealed message.");
  }
});
