// Pay per question, in NEAR. A site can let each visitor ask a few questions free per day, then ask for a small NEAR transfer per
// question. The visitor's wallet sends the transfer; the browser passes its transaction id in the X-Veil-Payment header ("<hash>:<signer>");
// this relay looks the transaction up on NEAR itself before forwarding anything. Nothing here needs a key: verifying is read-only.

export interface PayConfig { payTo: string; priceYocto: bigint; priceNear: string; freePerDay: number; network: string; rpcs: string[]; maxAgeMs: number }
export type Verdict = { ok: true; signer: string; hash: string } | { ok: false; reason: string };

const YOCTO = 10n ** 24n;
export function nearToYocto(near: string): bigint {
  const [whole, frac = ""] = near.trim().split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > 24) throw new Error(`bad NEAR amount: ${near}`);
  return BigInt(whole) * YOCTO + BigInt((frac + "0".repeat(24)).slice(0, 24));
}

export function payConfigFromEnv(env: Record<string, string | undefined>): PayConfig | null {
  if (!env.PAY_TO) return null;
  const network = env.PAY_NETWORK ?? (env.PAY_TO.endsWith(".testnet") ? "testnet" : "mainnet");
  const priceNear = env.PAY_PRICE_NEAR ?? "0.01";
  return {
    payTo: env.PAY_TO, priceNear, priceYocto: nearToYocto(priceNear), network,
    freePerDay: Math.max(0, Number(env.PAY_FREE_PER_DAY ?? 3)),
    rpcs: (env.PAY_RPC ?? (network === "testnet" ? "https://test.rpc.fastnear.com,https://rpc.testnet.near.org" : "https://free.rpc.fastnear.com,https://rpc.mainnet.near.org")).split(","),
    maxAgeMs: Number(env.PAY_MAX_AGE_MIN ?? 30) * 60_000,
  };
}

export class PayGate {
  private free = new Map<string, { day: string; n: number }>();
  /** Payments already accepted (or being used right now). In memory: a restart forgets them, but they also expire after maxAgeMs. */
  private spent = new Set<string>();
  constructor(readonly cfg: PayConfig, private f: typeof fetch = (...a) => fetch(...a), private now = () => Date.now()) {}

  info(ip?: string) {
    return { payTo: this.cfg.payTo, priceNear: this.cfg.priceNear, priceYocto: this.cfg.priceYocto.toString(), network: this.cfg.network, freePerDay: this.cfg.freePerDay, ...(ip ? { freeLeft: this.freeLeft(ip) } : {}) };
  }
  private today() { return new Date(this.now()).toISOString().slice(0, 10); }
  freeLeft(ip: string) { const e = this.free.get(ip); return e && e.day === this.today() ? Math.max(0, this.cfg.freePerDay - e.n) : this.cfg.freePerDay; }
  /** Uses one free question if any are left today. */
  takeFree(ip: string): boolean {
    const day = this.today(), e = this.free.get(ip);
    const n = e && e.day === day ? e.n : 0;
    if (n >= this.cfg.freePerDay) return false;
    this.free.set(ip, { day, n: n + 1 }); return true;
  }
  giveBackFree(ip: string) { const e = this.free.get(ip); if (e && e.n > 0) e.n--; }
  release(hash: string) { this.spent.delete(hash); }

  private async rpc(method: string, params: unknown): Promise<any> {
    let last: unknown;
    for (const url of this.cfg.rpcs) {
      try {
        const r = await this.f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "veil-pay", method, params }) });
        const j = await r.json();
        if (j.error) throw new Error(j.error.cause?.name ?? j.error.data ?? j.error.message ?? "rpc error");
        return j.result;
      } catch (e) { last = e; }
    }
    throw last instanceof Error ? last : new Error("no NEAR RPC answered");
  }

  /** Checks a payment header ("<tx hash>:<signer account>") against NEAR and reserves it, so it can't be used twice. */
  async verify(header: string): Promise<Verdict> {
    const m = /^([1-9A-HJ-NP-Za-km-z]{32,64}):([a-z0-9._-]{2,64})$/.exec(header.trim());
    if (!m) return { ok: false, reason: "malformed payment header" };
    const [, hash, signer] = m;
    if (this.spent.has(hash)) return { ok: false, reason: "this payment was already used" };
    this.spent.add(hash);
    try {
      const res = await this.rpc("tx", { tx_hash: hash, sender_account_id: signer, wait_until: "EXECUTED_OPTIMISTIC" });
      const tx = res?.transaction;
      if (!tx || tx.signer_id !== signer) throw new Error("transaction not found for that signer");
      if (tx.receiver_id !== this.cfg.payTo) throw new Error(`paid to ${tx.receiver_id}, not ${this.cfg.payTo}`);
      const paid = (tx.actions ?? []).reduce((sum: bigint, a: any) => sum + (a?.Transfer?.deposit ? BigInt(a.Transfer.deposit) : 0n), 0n);
      if (paid < this.cfg.priceYocto) throw new Error(`paid ${paid} yoctoNEAR, need ${this.cfg.priceYocto}`);
      if (!res.status || !("SuccessValue" in res.status)) throw new Error("the transfer did not succeed");
      const block = await this.rpc("block", { block_id: res.transaction_outcome?.block_hash });
      const at = Number(BigInt(block?.header?.timestamp ?? 0) / 1_000_000n);
      if (!at || this.now() - at > this.cfg.maxAgeMs) throw new Error("the payment is too old");
      return { ok: true, signer, hash };
    } catch (e) {
      this.spent.delete(hash);
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
}
