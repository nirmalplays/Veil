import { useState } from "react";
import { verifyReceipt, type Receipt, type ReceiptResult } from "@client/receipt";
import { view } from "./chain";
import { verifyFull } from "./verifier";
import { Badge, errMsg, short } from "./ui";

interface Policy { version: number; policy_hash: string; uri: string; recorded_ms: number }

/** Paste or load a receipt, and check it: enclave signature, attested key, and (optionally) the policy registered on NEAR. */
export function Receipts() {
  const [text, setText] = useState("");
  const [site, setSite] = useState("");
  const [full, setFull] = useState(true);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ res?: ReceiptResult; receipt?: Receipt; policy?: Policy; note?: string; err?: string }>();

  const check = async () => {
    setBusy(true); setOut(undefined);
    try {
      const receipt = JSON.parse(text) as Receipt;
      if (receipt.v !== 1) throw new Error("not a Veil receipt (v1)");
      let policy: Policy | undefined, note: string | undefined;
      if (site.trim()) {
        policy = (await view<Policy | null>("policy_at", { site_id: site.trim(), at_ms: receipt.createdAt })) ?? undefined;
        note = policy ? undefined : `No policy for "${site.trim()}" was registered on NEAR before this receipt was made.`;
      }
      const res = await verifyReceipt(receipt, { verifyAttestation: full ? verifyFull : undefined, policyHash: policy?.policy_hash });
      setOut({ res, receipt, policy, note });
    } catch (e) { setOut({ err: errMsg(e) }); } finally { setBusy(false); }
  };
  const load = async (f?: File) => { if (f) setText(await f.text()); };

  return (
    <div>
      <p className="muted">A receipt proves that a particular request and answer passed through an attested NEAR AI enclave, and, if you give the site id, which policy was registered on NEAR when it was made. It is checked here, in your browser.</p>
      <div className="row"><input type="file" accept="application/json,.json" onChange={(e) => load(e.target.files?.[0])} aria-label="Load a receipt file" /></div>
      <textarea style={{ width: "100%", minHeight: 120, fontFamily: "monospace", fontSize: 13 }} placeholder="Paste a receipt (JSON)" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        Site id <input placeholder="e.g. smith-law (optional)" value={site} onChange={(e) => setSite(e.target.value)} />
        <label><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> full attestation check (Intel TDX + NVIDIA GPUs)</label>
        <button className="btn-primary" onClick={check} disabled={busy || !text.trim()}>{busy ? "Checking…" : "Verify receipt"}</button>
      </div>
      {out?.err && <p className="err">{out.err}</p>}
      {out?.res && (
        <div className="card">
          <Badge kind={out.res.ok ? "ok" : "bad"}>{out.res.ok ? "receipt verified" : "not verified"}</Badge>
          {out.res.checks.map((c, i) => <div key={i}><Badge kind={c.ok ? "ok" : "bad"}>{c.ok ? "pass" : "fail"}</Badge> {c.label} <span className="muted">{c.detail}</span></div>)}
          <div style={{ marginTop: 10 }}>
            {out.res.compliance.checked ? (
              <>
                <Badge kind={out.res.compliance.ok ? "ok" : "bad"}>{out.res.compliance.ok ? "obeyed every checkable rule" : "broke a rule"}</Badge>
                {out.res.compliance.results.map((r, i) => <div key={i}><Badge kind={r.ok ? "ok" : "bad"}>{r.ok ? "obeyed" : "broken"}</Badge> {r.label} <span className="muted">{r.detail}</span></div>)}
                {!out.res.compliance.againstRegistry && <p className="muted">These are the rules the receipt's holder attached. Enter the site id to compare them with the policy registered on NEAR; without that they prove little.</p>}
                {out.res.compliance.note && <p className="muted">{out.res.compliance.note}</p>}
              </>
            ) : <p className="muted">{out.res.compliance.note}</p>}
            <p className="muted">Only rules a program can check are proven. Tone and judgement in the prompt (for example "no legal advice") are not.</p>
          </div>
          {out.policy && <p className="muted">Policy v{out.policy.version} registered on NEAR {new Date(out.policy.recorded_ms).toUTCString()}, hash {short(out.policy.policy_hash, 8)}.</p>}
          {out.note && <p className="muted">{out.note}</p>}
          {out.receipt && !out.receipt.disclosure && <p className="muted">This copy keeps the content private: it proves an exchange happened, not what was said.</p>}
          {out.res.messages && (
            <details open><summary>Disclosed content (matches the signed bytes)</summary>
              {out.res.messages.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.content}</div>)}
              <div className="msg assistant">{out.res.text}</div></details>
          )}
        </div>
      )}
    </div>
  );
}
