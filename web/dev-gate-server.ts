// Local stand-in for Supabase: the real blob-gate logic over a disk store. Run with `npm run gate`, then start the app with
// VITE_GATE_URL=http://localhost:8788. Authorization is real (NEP-413 sign-in, on-chain consent); only the storage is local.
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import { handle, makeChain, NRAS_URL, type Deps } from "../supabase/functions/_shared/gate.ts";

const PORT = Number(process.env.PORT ?? 8788), BASE = `http://localhost:${PORT}`;
const DIR = fileURLToPath(new URL("./.gate-store/", import.meta.url));
const file = (b: string, p: string) => `${DIR}${b}/${p}`;
const contract = process.env.VEIL_CONTRACT ?? "veil-31da02.testnet";
const rpcs = (process.env.NEAR_RPCS ?? "https://test.rpc.fastnear.com,https://rpc.testnet.near.org").split(",");

const deps: Deps = {
  secret: process.env.GATE_SECRET ?? randomUUID(), // a fresh secret per run: tokens die with the process
  now: () => Date.now(),
  verify: (pk, m, s) => ed25519.verify(s, m, pk),
  chain: makeChain(contract, rpcs),
  newId: () => randomUUID().replace(/-/g, ""),
  nras: (body) => fetch(NRAS_URL, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body }),
  storage: {
    async put(b, p, body) { mkdirSync(dirname(file(b, p)), { recursive: true }); writeFileSync(file(b, p), body); },
    async signedDownloadUrl(b, p) { return existsSync(file(b, p)) ? `${BASE}/dl/${b}/${p}` : null; },
    async remove(b, p) { if (existsSync(file(b, p))) unlinkSync(file(b, p)); },
    async exists(b, p) { return existsSync(file(b, p)); },
  },
};
const cors = { "Access-Control-Allow-Origin": "*" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", BASE);
  if (req.method === "GET") { // local stand-ins for Supabase's signed download URL and public bucket
    const m = /^\/(dl\/blobs|public\/rounds)\/(.+)$/.exec(url.pathname);
    if (m && !m[2].includes("..")) {
      const f = m[1] === "dl/blobs" ? file("blobs", m[2]) : file("rounds", m[2]);
      if (existsSync(f)) { res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(readFileSync(f)); return; }
    }
    res.writeHead(404, cors).end("not found"); return;
  }
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const r = await handle(new Request(BASE + req.url, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }), deps);
  res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log(`local blob gate on ${BASE} (contract ${contract})`));
