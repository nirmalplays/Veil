// NO RETENTION BY US: stores only opaque ciphertext and public round manifests; no plaintext, no logs of content.
// DEV blob store: PUT/GET opaque blobs on localhost. Stand-in for Supabase Storage; same URL-style blob_id.
// It only ever receives AES-GCM ciphertext (sessions) and public round manifests.
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("./.blobs/", import.meta.url));
mkdirSync(DIR, { recursive: true });
const PORT = Number(process.env.PORT ?? 8787);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "*" };
const safe = (s: string) => /^[A-Za-z0-9_-]{1,128}$/.test(s);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "OPTIONS") { res.writeHead(204, cors).end(); return; }
  const parts = url.pathname.split("/").filter(Boolean); // blobs/<id>  or  rounds/<root>
  if (parts.length === 2 && (parts[0] === "blobs" || parts[0] === "rounds") && safe(parts[1])) {
    const file = DIR + parts[0] + "_" + parts[1];
    if (req.method === "GET") {
      if (!existsSync(file)) { res.writeHead(404, cors).end("not found"); return; }
      res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(readFileSync(file)); return;
    }
    if (req.method === "DELETE" && parts[0] === "blobs") { // DEV ONLY: a real store would check a signed, owner-scoped URL
      if (existsSync(file)) unlinkSync(file);
      res.writeHead(204, cors).end(); return;
    }
    if (req.method === "PUT" && !existsSync(file)) {
      const chunks: Buffer[] = []; let n = 0;
      req.on("data", (c) => { n += c.length; if (n > 5_000_000) req.destroy(); else chunks.push(c); });
      req.on("end", () => { writeFileSync(file, Buffer.concat(chunks)); res.writeHead(201, cors).end("ok"); });
      return;
    }
    res.writeHead(409, cors).end("exists"); return;
  }
  if (req.method === "POST" && url.pathname === "/blobs") { // server-chosen id
    const id = randomBytes(16).toString("hex"); const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { writeFileSync(DIR + "blobs_" + id, Buffer.concat(chunks)); res.writeHead(201, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ id })); });
    return;
  }
  res.writeHead(404, cors).end("not found");
}).listen(PORT, () => console.log(`dev blob store on http://localhost:${PORT}`));
