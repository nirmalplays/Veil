// Full verification of a NEAR AI Cloud model attestation, following docs.near.ai/cloud/verification.
//  1. Intel TDX quote: signature chain, TCB status and debug bit, via @phala/dcap-qvl (collateral from Phala's PCCS).
//  2. REPORT_DATA taken from the verified quote must equal the model's signing key, then our nonce.
//  3. The event log replays to the quote's RTMR3, and app_compose hashes to the quote's MRCONFIGID.
//  4. NVIDIA GPU evidence: sent to NVIDIA's attestation service (NRAS), verdict and nonce checked, JWT signature checked against NVIDIA's keys.
// Each check reports ok / failed / skipped with a plain-language detail, so the UI and the CLI can show exactly what was and was not proven.
import { getCollateralAndVerify } from "@phala/dcap-qvl";
import { fromHex, toHex } from "./crypto.js";

export type CheckState = "ok" | "failed" | "skipped";
export interface Check { id: string; state: CheckState; label: string; detail: string }
export interface FullVerification { ok: boolean; checks: Check[]; publicKey?: string; model?: string; tcbStatus?: string; advisoryIds?: string[] }

/** TCB statuses we accept. Anything else (OutOfDate, Revoked, ...) fails the quote check. */
export const ACCEPTED_TCB = ["UpToDate", "SWHardeningNeeded"];
const NRAS = "https://nras.attestation.nvidia.com";

export interface TdFields { reportData: Uint8Array; mrConfigId: Uint8Array; rtMr3: Uint8Array; tdAttributes: Uint8Array }

const sha = async (alg: "SHA-256" | "SHA-384", d: Uint8Array) => new Uint8Array(await crypto.subtle.digest(alg, d as BufferSource));
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const u32le = (n: number) => new Uint8Array(new Uint32Array([n]).buffer);
const utf8 = (s: string) => new TextEncoder().encode(s);
const asObj = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);

/** Pure parse of the TD report body of a TDX v4 quote (48-byte header, then the body). Used for offline tests only; verification uses dcap-qvl's output. */
export function parseTdBody(quote: Uint8Array): TdFields {
  const b = quote.slice(48);
  return { tdAttributes: b.slice(120, 128), mrConfigId: b.slice(184, 232), rtMr3: b.slice(472, 520), reportData: b.slice(520, 584) };
}

/** Replay the RTMR3 event log: SHA-384 chain over the digest of each imr=3 event. */
export async function replayRtmr3(eventLog: any): Promise<Uint8Array> {
  const events: any[] = asObj(eventLog);
  let rtmr = new Uint8Array(48);
  for (const e of events) {
    if (e.imr !== 3) continue;
    const computed = await sha("SHA-384", cat(u32le(e.event_type), utf8(":"), utf8(e.event ?? ""), utf8(":"), fromHex(e.event_payload ?? "")));
    if (e.digest && toHex(computed) !== String(e.digest).toLowerCase()) throw new Error(`event "${e.event}" digest does not match its payload`);
    rtmr = await sha("SHA-384", cat(rtmr, computed));
  }
  return rtmr;
}

/** Expected MRCONFIGID: 0x01 || SHA-256(app_compose) || 15 zero bytes. app_compose is hashed as the raw string. */
export async function expectedMrConfigId(appCompose: string): Promise<Uint8Array> {
  return cat(Uint8Array.of(1), await sha("SHA-256", utf8(appCompose)), new Uint8Array(15));
}

/** Checks 2 and 3, given the TD fields from a verified quote. */
export async function checkTdBinding(c: any, nonce: string, td: TdFields): Promise<Check[]> {
  const out: Check[] = [];
  const key = fromHex(c.signing_public_key ?? "");
  const wantRd = cat(key, new Uint8Array(32 - key.length), fromHex(nonce));
  out.push(eq(td.reportData, wantRd)
    ? { id: "report-data", state: "ok", label: "Quote binds the model key and our nonce", detail: "REPORT_DATA from the verified quote equals the model's signing key followed by our fresh nonce." }
    : { id: "report-data", state: "failed", label: "Quote binds the model key and our nonce", detail: "REPORT_DATA in the verified quote does not match the model key and nonce. This key is not proven to live in this enclave." });
  try {
    const ti = asObj(c.info?.tcb_info);
    const events = c.event_log ?? ti?.event_log;
    const got = await replayRtmr3(events);
    out.push(eq(got, td.rtMr3)
      ? { id: "rtmr3", state: "ok", label: "Event log replays to the quote's RTMR3", detail: "Replaying the app's boot events reproduces the measured RTMR3, so the app id and compose hash in the log are authentic." }
      : { id: "rtmr3", state: "failed", label: "Event log replays to the quote's RTMR3", detail: "The replayed RTMR3 differs from the one in the verified quote." });
    const want = await expectedMrConfigId(ti.app_compose);
    out.push(eq(want, td.mrConfigId)
      ? { id: "mr-config", state: "ok", label: "Docker compose matches the quote's MRCONFIGID", detail: "SHA-256 of the app_compose text is the value the hardware measured." }
      : { id: "mr-config", state: "failed", label: "Docker compose matches the quote's MRCONFIGID", detail: "The compose file served with the report is not the one the hardware measured." });
  } catch (e) {
    out.push({ id: "rtmr3", state: "failed", label: "Event log and compose measurements", detail: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));
const jwtPart = (s: string) => JSON.parse(new TextDecoder().decode(b64u(s)));

/** Verifies an ES384/ES256 JWT signature against NVIDIA's published keys. Returns the claims. */
export async function verifyJwt(token: string, f: typeof fetch): Promise<any> {
  const [h, p, s] = token.split(".");
  const header = jwtPart(h), claims = jwtPart(p);
  const jwks = await (await f(`${NRAS}/.well-known/jwks.json`)).json();
  const jwk = jwks.keys.find((k: any) => k.kid === header.kid);
  if (!jwk) throw new Error(`signing key ${header.kid} not found in NVIDIA's key set`);
  const curve = header.alg === "ES384" ? "P-384" : "P-256", hash = header.alg === "ES384" ? "SHA-384" : "SHA-256";
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv ?? curve, x: jwk.x, y: jwk.y, ext: true }, { name: "ECDSA", namedCurve: curve }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash }, key, b64u(s) as BufferSource, utf8(`${h}.${p}`) as BufferSource);
  if (!ok) throw new Error("JWT signature does not verify against NVIDIA's key");
  return claims;
}

/** Check 4. Skipped (not failed) when the report carries no GPU evidence. */
/** `attestBase` may be a same-origin proxy (NVIDIA's service refuses browser CORS preflights). The proxy cannot forge a verdict: the signed JWT is checked against NVIDIA's keys, fetched directly. */
export async function checkNvidia(c: any, nonce: string, f: typeof fetch, attestBase = NRAS): Promise<Check> {
  const label = "NVIDIA confirms the GPUs are genuine and in confidential mode";
  if (!c.nvidia_payload) return { id: "nvidia", state: "skipped", label, detail: "This report carries no GPU evidence." };
  try {
    const payload = asObj(c.nvidia_payload);
    if (String(payload.nonce).toLowerCase() !== nonce.toLowerCase()) return { id: "nvidia", state: "failed", label, detail: "The GPU evidence carries a different nonce than ours." };
    const r = await f(`${attestBase}/v3/attest/gpu`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(`NVIDIA attestation service answered ${r.status}`);
    const body: any[] = await r.json();
    const token = body.find((x) => Array.isArray(x) && x[0] === "JWT")?.[1];
    if (!token) throw new Error("no overall JWT in NVIDIA's answer");
    const claims = await verifyJwt(token, f);
    if (claims["x-nvidia-overall-att-result"] !== true) return { id: "nvidia", state: "failed", label, detail: "NVIDIA's overall verdict is not true." };
    if (claims.eat_nonce && String(claims.eat_nonce).toLowerCase() !== nonce.toLowerCase()) return { id: "nvidia", state: "failed", label, detail: "NVIDIA's signed token carries a different nonce." };
    return { id: "nvidia", state: "ok", label, detail: "NVIDIA's attestation service returned a signed verdict of true for these GPUs, with our nonce. The token signature was checked against NVIDIA's published keys." };
  } catch (e) {
    return { id: "nvidia", state: "failed", label, detail: e instanceof Error ? e.message : String(e) };
  }
}

export interface VerifyOptions { candidate?: number; f?: typeof fetch; skipNvidia?: boolean; /** Base URL for NVIDIA's attestation POST, e.g. "/nras" behind a same-origin proxy. */ nrasProxy?: string }

/** Full verification of one model attestation candidate from a gateway report. */
export async function verifyModelAttestation(report: any, nonce: string, opts: VerifyOptions = {}): Promise<FullVerification> {
  const f = opts.f ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const checks: Check[] = [];
  const list: any[] = report?.model_attestations ?? [];
  if (!list.length) return { ok: false, checks: [{ id: "candidates", state: "failed", label: "Report lists model attestations", detail: "model_attestations is missing or empty." }] };
  checks.push({ id: "candidates", state: "ok", label: "Report lists model attestations", detail: `${list.length} candidate(s).` });
  const echoed = list.every((x) => x.request_nonce === nonce);
  checks.push({ id: "nonce", state: echoed ? "ok" : "failed", label: "Our fresh nonce is echoed (not a replay)", detail: echoed ? "Every candidate returns the nonce we just generated." : "A candidate returned a different nonce." });
  const c = list[opts.candidate ?? 0];
  const keyOk = c?.signing_algo === "ed25519" && /^[0-9a-f]{64}$/.test(c?.signing_public_key ?? "");
  checks.push({ id: "key", state: keyOk ? "ok" : "failed", label: "Model key is a valid Ed25519 key", detail: keyOk ? c.signing_public_key : "Missing or malformed signing key." });

  let tcbStatus: string | undefined, advisoryIds: string[] | undefined;
  try {
    const v: any = await getCollateralAndVerify(fromHex(c.intel_quote));
    tcbStatus = v.status; advisoryIds = v.advisory_ids ?? [];
    const d = v.report?.data;
    if (!d) throw new Error("verified quote has no TD10 report");
    const accepted = ACCEPTED_TCB.includes(v.status);
    checks.push({ id: "intel", state: accepted ? "ok" : "failed", label: "Intel confirms the quote came from genuine TDX hardware",
      detail: `Quote signature chain verified against Intel collateral (via Phala's PCCS). TCB status: ${v.status}${advisoryIds!.length ? `, advisories: ${advisoryIds!.join(", ")}` : ""}.` });
    const debug = (d.tdAttributes[0] & 1) === 1;
    checks.push({ id: "debug", state: debug ? "failed" : "ok", label: "Enclave is not in debug mode", detail: debug ? "The debug bit is set, so the host could read enclave memory." : "TD attributes show production mode." });
    checks.push(...(await checkTdBinding(c, nonce, { reportData: d.reportData, mrConfigId: d.mrConfigId, rtMr3: d.rtMr3, tdAttributes: d.tdAttributes })));
  } catch (e) {
    checks.push({ id: "intel", state: "failed", label: "Intel confirms the quote came from genuine TDX hardware", detail: e instanceof Error ? e.message : String(e) });
  }
  checks.push(opts.skipNvidia ? { id: "nvidia", state: "skipped", label: "NVIDIA confirms the GPUs are genuine and in confidential mode", detail: "Skipped by request." } : await checkNvidia(c, nonce, f, opts.nrasProxy));

  const ok = checks.every((x) => x.state !== "failed") && checks.some((x) => x.id === "intel" && x.state === "ok");
  return { ok, checks, publicKey: ok ? c.signing_public_key : undefined, model: c?.model_name, tcbStatus, advisoryIds };
}
