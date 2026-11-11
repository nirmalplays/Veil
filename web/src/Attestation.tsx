import { useState } from "react";
import { NearAI, attestationHash, teeChatModels } from "@client/nearai";
import type { Check, FullVerification } from "@client/verify";
import { verifyFull } from "./verifier";
import { getNearKey, getNearModel, setNearKey, setNearModel } from "./nearKey";
import { Badge, errMsg, short } from "./ui";

export interface AttResult { nonce: string; reportHash: string; model: string; v: FullVerification }

const MARK: Record<Check["state"], string> = { ok: "✓", failed: "✗", skipped: "–" };

export function AttestationResult({ a }: { a: AttResult }) {
  const failed = a.v.checks.filter((c) => c.state === "failed").length;
  return (
    <div className="card">
      <div className="row"><b>Attestation</b>
        <Badge kind={a.v.ok ? "ok" : "bad"}>{a.v.ok ? "Verified: genuine TDX hardware and NVIDIA GPUs" : `${failed} check(s) failed`}</Badge>
        <span className="muted">{a.model}</span></div>
      <div className="mono">nonce {short(a.nonce, 16)}</div>
      <div className="mono">report sha256 {short(a.reportHash, 16)}</div>
      {a.v.publicKey && <div className="mono">model key {short(a.v.publicKey, 16)}</div>}
      {a.v.tcbStatus && <div className="mono">Intel TCB status {a.v.tcbStatus}{a.v.advisoryIds?.length ? `, advisories ${a.v.advisoryIds.join(", ")}` : ""}</div>}
      <ul className="checks">{a.v.checks.map((c) => <li key={c.id} className={c.state}><span>{MARK[c.state]}</span><div><b>{c.label}</b><div className="muted">{c.detail}</div></div></li>)}</ul>
      <div className="muted">Not checked: the enclave's TLS binding, the image's build provenance (Sigstore), and whether this app version is on an approved list. We confirm the model's hardware, the gateway's hardware, and that the app each one measured is the one served.</div>
    </div>
  );
}

export function AttestationPanel({ onResult }: { onResult?: (a: AttResult) => void }) {
  const [key, setKey] = useState(getNearKey());
  const [model, setModel] = useState(getNearModel());
  const [tee, setTee] = useState<{ id: string; note: string }[]>([]);
  const [res, setRes] = useState<AttResult>();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchIt = async () => {
    setErr(""); setBusy(true); setNearKey(key); setNearModel(model);
    try {
      const { nonce, report } = await new NearAI(key).attestation(model);
      const r = { nonce, model, reportHash: await attestationHash(report), v: await verifyFull(report, nonce) };
      setRes(r); onResult?.(r);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  /** Models come from the endpoint. Only the ones NEAR AI runs itself are in attested TEEs, so those are the ones offered. */
  const listModels = async () => {
    setErr(""); setBusy(true);
    try {
      const t = teeChatModels(await new NearAI(key).models());
      setTee(t.map((m) => ({ id: m.id, note: `${m.id} ($${m.pricing?.input ?? "?"} in, $${m.pricing?.output ?? "?"} out per million tokens)` })));
      if (!t.some((m) => m.id === model) && t[0]) setModel(t[0].id);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <details className="card">
      <summary><b>NEAR AI attestation</b> <span className="muted">(free, no credits needed)</span></summary>
      <div className="row"><input type="password" placeholder="NEAR AI API key (kept in memory only)" value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1 }} />
        <input list="tee-models" value={model} onChange={(e) => setModel(e.target.value)} style={{ flex: 1 }} aria-label="Model" />
        <datalist id="tee-models">{tee.map((m) => <option key={m.id} value={m.id}>{m.note}</option>)}</datalist>
        <button onClick={listModels} disabled={busy || !key}>List TEE models</button>
        <button onClick={fetchIt} disabled={busy || !key}>{busy ? "Verifying…" : "Fetch and verify"}</button></div>
      {err && <p className="err">{err}</p>}
      {!onResult && res && <AttestationResult a={res} />}
    </details>
  );
}
