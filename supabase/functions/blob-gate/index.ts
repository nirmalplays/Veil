// Supabase Edge Function entry. All decisions live in ../_shared/gate.ts; this file only plugs in Supabase Storage,
// the NEAR RPC and the Ed25519 verifier. Required secret: GATE_SECRET (any long random string).
import { createClient } from "npm:@supabase/supabase-js@2";
import { ed25519 } from "npm:@noble/curves@2.4.0/ed25519.js";
import { handle, makeChain, NRAS_URL, type Deps } from "../_shared/gate.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const secret = Deno.env.get("GATE_SECRET");
if (!secret) throw new Error("Set GATE_SECRET: supabase secrets set GATE_SECRET=$(openssl rand -hex 32)");
const contract = Deno.env.get("VEIL_CONTRACT") ?? "veil-31da02.testnet";
const rpcs = (Deno.env.get("NEAR_RPCS") ?? "https://test.rpc.fastnear.com,https://rpc.testnet.near.org").split(",");

const deps: Deps = {
  secret,
  now: () => Date.now(),
  verify: (pk, msg, sig) => ed25519.verify(sig, msg, pk),
  chain: makeChain(contract, rpcs),
  newId: () => crypto.randomUUID().replace(/-/g, ""),
  nras: (body) => fetch(NRAS_URL, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body }),
  storage: {
    async signedDownloadUrl(bucket, path, seconds) {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, seconds);
      return error || !data ? null : data.signedUrl;
    },
    async remove(bucket, path) { await sb.storage.from(bucket).remove([path]); },
    async exists(bucket, path) {
      const i = path.lastIndexOf("/");
      const { data } = await sb.storage.from(bucket).list(i < 0 ? "" : path.slice(0, i), { search: path.slice(i + 1) });
      return !!data?.some((o) => o.name === path.slice(i + 1));
    },
    async put(bucket, path, body) {
      const { error } = await sb.storage.from(bucket).upload(path, new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
      if (error) throw new Error(error.message);
    },
  },
};

Deno.serve((req) => handle(req, deps).catch((e) => new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } })));
