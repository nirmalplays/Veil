import { CONTRACT, RPCS } from "./config";

async function rpc(method: string, params: unknown) {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "f", method, params }) });
      const j = await r.json();
      if (j.error) {
        if (j.error.cause?.name === "UNKNOWN_ACCESS_KEY") throw Object.assign(new Error("unknown access key"), { final: true });
        throw new Error(JSON.stringify(j.error.data ?? j.error));
      }
      return j.result;
    } catch (e) { if ((e as any)?.final) throw e; last = e; } // network/429/5xx: try the next endpoint
  }
  throw last instanceof Error ? last : new Error("all RPC endpoints failed");
}

/** Read-only contract call. */
export async function view<T = any>(method: string, args: object = {}): Promise<T> {
  const res = await rpc("query", { request_type: "call_function", finality: "final", account_id: CONTRACT,
    method_name: method, args_base64: btoa(JSON.stringify(args)) });
  const text = new TextDecoder().decode(new Uint8Array(res.result));
  return JSON.parse(text) as T;
}

export async function hasAccessKey(accountId: string, publicKey: string): Promise<boolean> {
  try { await rpc("query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey }); return true; }
  catch { return false; }
}
