import { useState } from "react";
import { decrypt, importKey, type Sealed } from "@client/crypto";
import { generateEncKeyPair, unwrapSessionKey } from "@client/keywrap";
import { merkleRoot } from "@client/merkle";
import { buildMemoryPrompt, rank } from "@client/memory";
import { attestationHash } from "@client/nearai";
import { view } from "./chain";
import { call, callMany } from "./wallet";
import { getBlob, putManifest } from "./blobs";
import { loadOwnerKey, saveOwnerKey } from "./store";
import { PROVIDERS } from "./providers";
import { Badge, errMsg, short } from "./ui";

interface Item { hash: string; owner: string; text?: string; score?: number; attestation?: unknown; error?: string }

async function score(text: string, tags: string[], pid: string): Promise<{ score: number; attestation?: unknown }> {
  const p = PROVIDERS[pid];
  const prompt = `Rate from 0 to 100 how useful the following conversation would be as retrieval context for an assistant specialised in: ${tags.join(", ") || "general help"}. Answer with only the integer.\n\n${text.slice(0, 4000)}`;
  const r = await p.make().chat(p.model, [{ role: "user", content: prompt }]);
  const n = parseInt(r.text.match(/\d+/)?.[0] ?? "", 10);
  if (Number.isNaN(n)) throw new Error(`could not parse a score from: ${r.text.slice(0, 40)}`);
  return { score: Math.max(0, Math.min(100, n)), attestation: r.attestation?.report };
}

export function Owner({ account }: { account?: string }) {
  const [model, setModel] = useState("demo-model");
  const [tags, setTags] = useState("code, privacy");
  const [pid, setPid] = useState("ollama");
  const [info, setInfo] = useState<any>();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const key = loadOwnerKey(model);
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<{ q: string; text: string; sources: { hash: string; owner: string }[]; considered: number; attestation?: unknown; provider: string; anchored?: boolean }>();

  const load = async () => {
    setErr("");
    try { setInfo((await view("get_model", { model_id: model })) ?? null); } catch (e) { setErr(errMsg(e)); }
  };
  const register = async () => {
    setErr("");
    try {
      const kp = key ?? generateEncKeyPair();
      saveOwnerKey(model, { publicKey: kp.publicKey, secretKey: kp.secretKey });
      await call("register_model", { model_id: model, meta_hash: "web", enc_pubkey: kp.publicKey, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });
    } catch (e) { setErr(errMsg(e)); }
  };

  /** Fetches and decrypts one session. Consent is read from the chain at this moment, so a revoked or muted session fails here. */
  const readOne = async (hash: string): Promise<Item> => {
    const it: Item = { hash, owner: "" };
    try {
      const [sess, cons] = await Promise.all([view("get_session", { session_hash: hash }), view("get_consent", { session_hash: hash, model_id: model })]);
      if (!cons) throw new Error("no live consent");
      it.owner = sess.owner;
      const sealed = await getBlob<Sealed>(sess.blob_id, { sessionHash: hash, modelId: model });
      const k = await importKey(await unwrapSessionKey(cons.wrapped_key, key!.secretKey, hash));
      const plain = JSON.parse(await decrypt(k, sealed, sess.owner));
      it.text = (plain.messages as { role: string; content: string }[]).map((m) => `${m.role}: ${m.content}`).join("\n");
    } catch (e) { it.error = errMsg(e); }
    return it;
  };

  const run = async () => {
    if (!key) { setErr("No decryption key for this model in this browser."); return; }
    setBusy(true); setErr(""); setItems([]);
    try {
      const hashes: string[] = await view("consented_sessions", { model_id: model, from: 0, limit: 50 });
      const out: Item[] = [];
      for (const hash of hashes) {
        const it = await readOne(hash);
        if (it.text) {
          try { const sc = await score(it.text, info?.tags ?? [], pid); it.score = sc.score; it.attestation = sc.attestation; }
          catch (e) { it.error = errMsg(e); }
        }
        out.push(it); setItems([...out]);
      }
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  /** Answers a question using only sessions whose consent is live at this moment, and says which ones it used. */
  const ask = async () => {
    if (!key || !q.trim()) return;
    setBusy(true); setErr(""); setAns(undefined);
    try {
      const hashes: string[] = await view("consented_sessions", { model_id: model, from: 0, limit: 50 });
      const read = await Promise.all(hashes.map(readOne));
      const usable = read.filter((i) => i.text);
      const hits = rank(q, usable.map((i) => ({ id: i.hash, text: i.text! })), 3);
      const ctx = buildMemoryPrompt(hits);
      const p = PROVIDERS[pid];
      const r = await p.make().chat(p.model, [...(ctx ? [{ role: "system" as const, content: ctx }] : []), { role: "user" as const, content: q.trim() }]);
      setAns({ q: q.trim(), text: r.text, considered: usable.length, attestation: r.attestation?.report, provider: p.make().name,
        sources: hits.map((h) => ({ hash: h.id, owner: usable.find((u) => u.hash === h.id)!.owner })) });
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  /** Anchors the sessions that fed this answer as one round, so each user can later prove their session was used. */
  const anchorUse = async () => {
    if (!ans?.sources.length) return;
    setBusy(true); setErr("");
    try {
      const leaves = ans.sources.map((x) => x.hash), root = merkleRoot(leaves);
      await putManifest(root, leaves);
      const att = ans.attestation ? await attestationHash(ans.attestation) : await attestationHash({ provider: ans.provider, note: "no TEE attestation (dev)" });
      await call("record_round", { model_id: model, merkle_root: root, attestation_hash: att, leaf_count: leaves.length });
      setAns({ ...ans, anchored: true });
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const anchor = async () => {
    const ok = items.filter((i) => i.score !== undefined);
    if (!ok.length) return;
    setBusy(true); setErr("");
    try {
      const leaves = ok.map((i) => i.hash);
      const root = merkleRoot(leaves);
      await putManifest(root, leaves);
      // With NEAR AI the anchored hash is the real attestation report the scoring ran under; otherwise a labelled dev marker.
      const rep = ok.find((i) => i.attestation)?.attestation;
      const att = rep ? await attestationHash(rep) : await attestationHash({ provider: PROVIDERS[pid].make().name, model: PROVIDERS[pid].model, note: "no TEE attestation (dev)" });
      await callMany([
        ...ok.map((i) => ({ methodName: "record_eval", args: { session_hash: i.hash, model_id: model, score: i.score, attestation_hash: att } })),
        { methodName: "record_round", args: { model_id: model, merkle_root: root, attestation_hash: att, leaf_count: leaves.length } },
      ]);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  if (!account) return <p className="muted">Connect a wallet to act as a model owner.</p>;
  const mine = info && info.owner === account;
  return (
    <div>
      <div className="row">Model id <input value={model} onChange={(e) => setModel(e.target.value)} /><button onClick={load}>Look up</button></div>
      {info === null && (
        <div className="card"><div className="row">Not registered. Tags <input value={tags} onChange={(e) => setTags(e.target.value)} />
          <button onClick={register}>Register (generates a decryption key in this browser)</button></div>
          <p className="muted">Back up the key: sessions shared with this model can only be read with it. DEV: it is stored in localStorage.</p></div>)}
      {info && (
        <div className="card">
          <div className="row"><b>{model}</b> <span className="muted">owner {info.owner}</span>
            {mine ? <Badge kind="ok">you own this</Badge> : <Badge kind="bad">owned by someone else</Badge>}
            {key ? <Badge kind="ok">decryption key present</Badge> : <Badge kind="bad">no decryption key here</Badge>}</div>
          <div className="muted">tags: {info.tags.join(", ") || "none"} · enc_pubkey {short(info.enc_pubkey, 10)}</div>
          <div className="row">Score with <select value={pid} onChange={(e) => setPid(e.target.value)}>{Object.keys(PROVIDERS).map((p) => <option key={p}>{p}</option>)}</select>
            {pid === "near-ai" ? <Badge kind="ok">Scored in a TEE, E2EE. Real attestation hash is anchored</Badge> : <Badge kind="warn">DEV: scoring is not in a TEE, no attestation</Badge>}</div>
          <div className="row"><button disabled={busy || !mine} onClick={run}>Load consented sessions and score</button>
            <button disabled={busy || !mine || !items.some((i) => i.score !== undefined)} onClick={anchor}>Record scores and anchor round</button></div>
        </div>)}
      {info && mine && (
        <div className="card">
          <b>Answer with consented memory</b>
          <p className="muted">Retrieval, not training: no model weights change. Each question re-checks consent on NEAR, decrypts only sessions shared with you right now, picks the most relevant few, and sends them as context inside an encrypted request. Mute, revoke or forget a session and it is gone from the next answer.</p>
          <div className="row"><input style={{ flex: 1 }} placeholder="Ask something your consented sessions might help with" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && ask()} />
            <button className="btn-primary" disabled={busy || !key || !q.trim()} onClick={ask}>{busy ? "Working…" : "Ask"}</button></div>
          {ans && (
            <div>
              <div className="msg assistant">{ans.text || "(no answer; try again)"}</div>
              <p className="muted">Used {ans.sources.length} of {ans.considered} sessions with live consent.</p>
              {ans.sources.map((x) => <div key={x.hash} className="mono">source {short(x.hash, 12)} <span className="muted">from {x.owner}</span></div>)}
              {ans.sources.length > 0 && <div className="row"><button disabled={busy || ans.anchored} onClick={anchorUse}>{ans.anchored ? "Use recorded on NEAR ✓" : "Record this use on NEAR"}</button>
                <span className="muted">Anchors the sources as a round so each user can verify their session was used.</span></div>}
            </div>)}
        </div>)}
      {err && <p className="err">{err}</p>}
      {items.map((i) => (
        <div className="card" key={i.hash}>
          <div className="row"><span className="mono">{short(i.hash, 12)}</span><span className="muted">from {i.owner}</span>
            {i.score !== undefined && <Badge kind="ok">score {i.score}</Badge>}{i.error && <Badge kind="bad">{i.error}</Badge>}</div>
          {i.text && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>{i.text.slice(0, 300)}</div>}
        </div>))}
    </div>
  );
}
