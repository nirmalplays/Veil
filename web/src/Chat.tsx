import { useState } from "react";
import { encrypt, exportKey, generateKey, sessionHash } from "@client/crypto";
import type { ChatMessage } from "@client/nearai";
import { PROVIDERS } from "./providers";
import { putBlob } from "./blobs";
import { call } from "./wallet";
import { saveSession } from "./store";
import { Badge, errMsg } from "./ui";
import samples from "@samples/sessions.json";
import { AttestationPanel, AttestationResult, type AttResult } from "./Attestation";
import { attestationHash } from "@client/nearai";
import { NearAIProvider, type ProviderResult } from "@client/provider";
import { redact, verifyReceipt, type Receipt } from "@client/receipt";
import { checkRules, policyHash, type Policy, type Rule } from "@client/policy";
import { verifyFull } from "./verifier";

export function Chat({ account }: { account?: string }) {
  const [pid, setPid] = useState("ollama");
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [att, setAtt] = useState<AttResult>();
  const [policyText, setPolicyText] = useState("");   // master prompt, sent as the system message
  const [maxWords, setMaxWords] = useState("");        // rules a program can check on every reply; they are part of the registered hash
  const [mustSay, setMustSay] = useState("");
  const [mustNot, setMustNot] = useState("");
  const policy: Policy | undefined = (() => {
    if (!policyText.trim()) return undefined;
    const rules: Rule[] = [];
    if (+maxWords > 0) rules.push({ type: "max_words", n: Math.floor(+maxWords) });
    if (mustSay.trim()) rules.push({ type: "must_include", text: mustSay.trim() });
    for (const t of mustNot.split(",").map((x) => x.trim()).filter(Boolean)) rules.push({ type: "must_not_include", text: t });
    return { prompt: policyText.trim(), rules };
  })();
  const [site, setSite] = useState("");
  // Receipts are opt-in. While the toggle is off nothing is kept; while on, the wire record of each answer is held in memory
  // only, and a receipt is made only for the answers the user picks. The log lives in memory and is gone on reload.
  const [track, setTrack] = useState(false);
  const [showLog, setShowLog] = useState(false);
  type Kept = { result: ProviderResult; sent: ChatMessage[]; model: string; policy?: Policy };
  type Entry = { id: string; at: number; receipt: Receipt; quick: { ok: boolean; failed: string[] }; full?: { ok: boolean; failed: string[] } };
  const [kept, setKept] = useState<Record<number, Kept>>({});   // keyed by the answer's index in the thread
  const [log, setLog] = useState<Entry[]>([]);
  const [sample, setSample] = useState("");  // set while the thread is a fictional sample
  let provider: ReturnType<(typeof PROVIDERS)[string]["make"]>;
  try { provider = PROVIDERS[pid].make(); } catch { provider = PROVIDERS.mock.make(); }

  const send = async () => {
    if (!input.trim()) return;
    const next: ChatMessage[] = [...msgs, { role: "user", content: input }];
    setMsgs(next); setInput(""); setBusy(true); setErr("");
    try {
      setSample("");
      const sent: ChatMessage[] = policy ? [{ role: "system", content: policy.prompt }, ...next] : next;
      const r = await PROVIDERS[pid].make().chat(PROVIDERS[pid].model, sent);
      if (track && r.wire) setKept((k) => ({ ...k, [next.length]: { result: r, sent, model: PROVIDERS[pid].model, policy } }));
      if (r.attestation?.full) setAtt({ nonce: r.attestation.nonce, model: PROVIDERS[pid].model, reportHash: await attestationHash(r.attestation.report), v: r.attestation.full });
      setMsgs([...next, { role: "assistant", content: r.text }]);
      const broke = checkRules(policy?.rules, r.text).filter((x) => !x.ok);
      if (broke.length) setNote(`This reply broke your policy: ${broke.map((x) => `${x.label} (${x.detail})`).join("; ")}.`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const publishPolicy = async () => {
    setErr(""); setNote("");
    if (!account) { setErr("Connect a wallet first."); return; }
    if (!site.trim() || !policy) { setErr("Give a site id and a policy first."); return; }
    try {
      const h = policyHash(policy);
      await call("publish_policy", { site_id: site.trim(), policy_hash: h, uri: "" });
      setNote(`Policy hash ${h.slice(0, 12)}… (prompt and ${policy.rules?.length ?? 0} rules) published for "${site.trim()}". Only the hash goes on chain.`);
    } catch (e) { setErr(errMsg(e)); }
  };

  const getReceipt = async (idx: number) => {
    const k = kept[idx]; if (!k) return;
    setErr("");
    try {
      const p = PROVIDERS[pid].make();
      if (!(p instanceof NearAIProvider)) throw new Error("Receipts need the NEAR AI provider.");
      const receipt = await p.receipt(k.model, k.result, { policy: k.policy, disclose: { messages: k.sent } });
      const q = await verifyReceipt(receipt);
      setLog((l) => [{ id: receipt.id, at: receipt.createdAt, receipt, quick: { ok: q.ok, failed: q.checks.filter((c) => !c.ok).map((c) => c.label) } }, ...l.filter((e) => e.id !== receipt.id)]);
      setShowLog(true); setNote("Receipt added to the log below.");
    } catch (e) { setErr(errMsg(e)); }
  };
  const checkFull = async (e: Entry) => {
    setErr("");
    try {
      const r = await verifyReceipt(e.receipt, { verifyAttestation: verifyFull });
      setLog((l) => l.map((x) => x.id === e.id ? { ...x, full: { ok: r.ok, failed: r.checks.filter((c) => !c.ok).map((c) => c.label) } } : x));
    } catch (er) { setErr(errMsg(er)); }
  };
  const saveFile = (e: Entry, disclose: boolean) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(disclose ? e.receipt : redact(e.receipt), null, 2)], { type: "application/json" }));
    a.download = `receipt-${e.id.slice(0, 8)}${disclose ? "-with-content" : ""}.json`; a.click();
    setNote(disclose ? "Saved with the prompt and reply inside. Share only with people who may read them." : "Saved. It proves the exchange happened without revealing what was said.");
  };
  const toggleTrack = (on: boolean) => { setTrack(on); if (!on) { setKept({}); setLog([]); setShowLog(false); } };   // turning it off forgets everything kept

  const save = async () => {
    if (!account) { setErr("Connect a wallet first."); return; }
    setBusy(true); setErr(""); setNote("");
    try {
      const key = await generateKey();
      const sealed = await encrypt(key, JSON.stringify({ provider: sample ? "Fictional sample" : provider.name, private: sample ? false : provider.private, messages: msgs }), account);
      const hash = await sessionHash(sealed);
      const blobId = await putBlob(sealed);
      saveSession(account, { hash, blobId, keyHex: await exportKey(key), title: (sample && samples.sessions.find((x) => x.id === sample)?.title) || msgs[0]?.content.slice(0, 48) || "session",
        createdMs: Date.now(), provider: sample ? "Fictional sample" : provider.name, private: sample ? false : provider.private, committed: false });
      setNote(`Encrypted in your browser and uploaded. Committing ${hash.slice(0, 12)}… on NEAR — approve in your wallet.`);
      await call("commit_session", { session_hash: hash, blob_id: blobId });
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="row">
        <select value={pid} onChange={(e) => setPid(e.target.value)}>{Object.keys(PROVIDERS).map((p) => <option key={p}>{p}</option>)}</select>
        {provider.private ? <Badge kind="ok">TEE + E2EE</Badge> : <Badge kind="warn">DEV: not private, no attestation</Badge>}
        <button onClick={() => { setMsgs([]); setNote(""); setErr(""); setSample(""); setKept({}); }} disabled={busy || msgs.length === 0}>New chat</button>
        <select aria-label="Load a fictional sample session" value="" onChange={(e) => { const s = samples.sessions.find((x) => x.id === e.target.value); if (s) { setMsgs(s.messages as ChatMessage[]); setSample(s.id); setKept({}); setNote(`Sample: ${s.why}`); setErr(""); } }}>
          <option value="">Load a fictional sample…</option>
          {samples.sessions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>
      {!account && <div className="guide"><b>Start here.</b> Create an inline wallet in the top bar. It takes a few seconds and needs no extension.</div>}
      <AttestationPanel onResult={setAtt} />
      {att && <AttestationResult a={att} />}
      <div className="thread">
        {msgs.length === 0 && <div className="empty"><b>Start a conversation</b>It runs on {provider.name}. When you are done, seal it and decide who may use it.</div>}
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.content}</div>)}
        <div className="composer"><input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && send()} placeholder="Message" />
          <button className="btn-primary" onClick={send} disabled={busy}>Send</button></div>
      </div>
      <details className="card"><summary>Policy (master prompt and guardrails)</summary>
        <textarea style={{ width: "100%", minHeight: 80 }} placeholder="e.g. You are the intake assistant for a law firm. Never give legal advice. Say you are an AI." value={policyText} onChange={(e) => setPolicyText(e.target.value)} />
        <div className="row"><b>Rules a program can check</b>
          max words <input type="number" min={0} style={{ width: 70 }} value={maxWords} onChange={(e) => setMaxWords(e.target.value)} />
          must mention <input style={{ width: 110 }} value={mustSay} onChange={(e) => setMustSay(e.target.value)} />
          must never say <input placeholder="comma separated" style={{ width: 170 }} value={mustNot} onChange={(e) => setMustNot(e.target.value)} /></div>
        <div className="row">Site id <input placeholder="e.g. smith-law" value={site} onChange={(e) => setSite(e.target.value)} />
          <button onClick={publishPolicy} disabled={!policy || !site.trim()}>Publish policy hash on NEAR</button></div>
        <p className="muted">The prompt is sent as the system message. The rules are checked mechanically against every reply by anyone holding a receipt with content. Rules cannot express tone or judgement, so the prompt alone is not proven to be obeyed.</p></details>
      {provider instanceof NearAIProvider && (
        <div className="row">
          <label><input type="checkbox" checked={track} onChange={(e) => toggleTrack(e.target.checked)} /> Allow receipts for this chat</label>
          {track && <span className="muted">Off by default. Nothing is made until you press “Get receipt” for an answer in the log.</span>}
          {track && <label><input type="checkbox" checked={showLog} onChange={(e) => setShowLog(e.target.checked)} /> Show receipt log ({log.length} made, {Object.keys(kept).length} available)</label>}
        </div>
      )}
      {track && showLog && (
        <div className="card"><b>Receipt log</b> <span className="muted">(kept in this tab only; gone on reload or when receipts are turned off)</span>
          {Object.keys(kept).length === 0 && log.length === 0 && <p className="muted">Nothing to receipt yet. Answers received while receipts are allowed are listed here.</p>}
          {Object.entries(kept).map(([i, k]) => {
            const made = log.some((e) => e.id === k.result.id);
            return (
              <div key={i} className="row">
                <span className="muted">Answer {Math.ceil((+i + 1) / 2)}:</span> <span>{k.result.text.slice(0, 60)}{k.result.text.length > 60 ? "…" : ""}</span>
                <button onClick={() => getReceipt(+i)} disabled={busy || made}>{made ? "Receipt made ✓" : "Get receipt"}</button>
              </div>
            );
          })}
          {log.length > 0 && <hr />}
          {log.map((e) => (
            <div key={e.id} className="row">
              <Badge kind={e.quick.ok ? "ok" : "bad"}>{e.quick.ok ? "signature ok" : "invalid"}</Badge>
              {e.full && <Badge kind={e.full.ok ? "ok" : "bad"}>{e.full.ok ? "TDX + GPU verified" : "attestation failed"}</Badge>}
              <span>{new Date(e.at).toLocaleTimeString()} · {e.id.slice(0, 8)}</span>
              <button onClick={() => checkFull(e)}>Check fully</button>
              <button onClick={() => saveFile(e, false)}>Save (proof only)</button>
              <button onClick={() => saveFile(e, true)}>Save with content</button>
              {(e.quick.failed.length > 0 || (e.full && e.full.failed.length > 0)) && <span className="err">{[...e.quick.failed, ...(e.full?.failed ?? [])].join("; ")}</span>}
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 14 }}><button className="btn-primary" onClick={save} disabled={busy || msgs.length === 0}>Encrypt, upload and commit on NEAR</button></div>
      {note && <p className="muted">{note}</p>}{err && <p className="err">{err}</p>}
    </div>
  );
}
