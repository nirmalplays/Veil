import { useEffect, useState } from "react";
import { exportKey, importKey } from "@client/crypto";
import { wrapSessionKey } from "@client/keywrap";
import { consentState, type ConsentState } from "@client/consent";
import { forgetResidue } from "@client/residue";
import { view } from "./chain";
import { call } from "./wallet";
import { deleteBlob, getManifest } from "./blobs";
import { loadSessions, updateSession, type LocalSession } from "./store";
import { Badge, errMsg, short } from "./ui";

interface Chain { committed: boolean; forgotten: boolean; consent: { expires_ms: number | null; paused: boolean } | null; evalScore?: number }

const STATE_LABEL: Record<ConsentState, string> = { active: "Shared", pinned: "Pinned", muted: "Muted", expired: "Expired", none: "Not shared" };

export function Sessions({ account }: { account?: string }) {
  const [rows, setRows] = useState<LocalSession[]>([]);
  const [st, setSt] = useState<Record<string, Chain>>({});
  const [model, setModel] = useState("demo-model");
  const [days, setDays] = useState(7);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState("");

  const refresh = async () => {
    if (!account) return;
    const list = loadSessions(account); setRows(list);
    const next: Record<string, Chain> = {};
    for (const s of list) {
      try {
        const [sess, cons, ev] = await Promise.all([
          view("get_session", { session_hash: s.hash }),
          view("consent_info", { session_hash: s.hash, model_id: model }),
          view("get_eval", { session_hash: s.hash, model_id: model })]);
        next[s.hash] = { committed: !!sess, forgotten: !!sess?.forgotten, consent: cons ?? null, evalScore: ev?.score };
      } catch (e) { setErr(errMsg(e)); }
    }
    setSt(next);
  };
  useEffect(() => { refresh(); }, [account, model]);

  const act = async (hash: string, label: string, fn: () => Promise<void>) => {
    setErr(""); setBusy(hash + label);
    try { await fn(); await refresh(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(""); }
  };
  const args = (s: LocalSession) => ({ session_hash: s.hash, model_id: model });

  const grant = (s: LocalSession) => act(s.hash, "grant", async () => {
    const m = await view("get_model", { model_id: model });
    if (!m) throw new Error(`model "${model}" is not registered`);
    const wrapped = await wrapSessionKey(await exportKey(await importKey(s.keyHex)), m.enc_pubkey, s.hash);
    await call("grant_consent", { session_hash: s.hash, model_id: model, expires_ms: Date.now() + days * 86_400_000, wrapped_key: wrapped });
    updateSession(account!, s.hash, (x) => ({ ...x, sharedWith: Array.from(new Set([...(x.sharedWith ?? []), model])) }));
  });

  const forget = (s: LocalSession) => act(s.hash, "forget", async () => {
    await call("forget_session", { session_hash: s.hash });
    const gone = await deleteBlob(s.blobId); // the contract's session_forgotten event says the same thing; we act on it directly
    const models = Array.from(new Set([...(s.sharedWith ?? []), model]));
    const evals: Record<string, number | undefined> = {}; const rounds: { model: string; root: string; leaves?: string[] }[] = [];
    for (const m of models) {
      evals[m] = (await view("get_eval", { session_hash: s.hash, model_id: m }))?.score;
      for (const r of await view<{ merkle_root: string }[]>("get_rounds", { model_id: m })) {
        rounds.push({ model: m, root: r.merkle_root, leaves: await getManifest(r.merkle_root).then((x) => x.leaves).catch(() => undefined) });
      }
    }
    const residue = forgetResidue({ sessionHash: s.hash, sharedWith: s.sharedWith ?? [], evals, rounds, blobGone: gone });
    updateSession(account!, s.hash, (x) => ({ ...x, forgotten: true, keyHex: "", residue }));
    setConfirm("");
  });

  if (!account) return <p className="muted">Sign in to see your sessions.</p>;
  return (
    <div>
      <div className="row">Controls apply to model <input value={model} onChange={(e) => setModel(e.target.value)} />
        share for <input type="number" min={1} value={days} onChange={(e) => setDays(+e.target.value)} style={{ width: 60 }} /> days
        <button onClick={refresh}>Refresh</button></div>
      <p className="muted"><b>Share</b> lets that model owner read one session until it expires. <b>Pin</b> removes the expiry. <b>Mute</b> pauses it without losing the grant. <b>Revoke</b> removes the grant. <b>Forget</b> ends all use of the session for good and deletes our copy of the encrypted blob. None of these can undo a round that already used the session: the record stays on NEAR, and nothing was trained, so there are no weights to un-train.</p>
      {err && <p className="err">{err}</p>}
      {rows.length === 0 && <p className="muted">No saved sessions yet. Save one from the Chat tab.</p>}
      {rows.map((s) => {
        const x = st[s.hash]; const forgotten = s.forgotten || x?.forgotten;
        const state = consentState(x?.consent, Date.now());
        const b = (l: string) => busy === s.hash + l;
        return (
          <div className="card" key={s.hash}>
            <div className="row"><b>{s.title}</b>
              {s.private ? <Badge kind="ok">private</Badge> : <Badge kind="warn">dev, not private</Badge>}
              {x && (x.committed ? <Badge kind="ok">committed on-chain</Badge> : <Badge kind="bad">not committed</Badge>)}
              {forgotten ? <Badge kind="bad">forgotten</Badge>
                : x && <Badge kind={state === "active" || state === "pinned" ? "ok" : state === "none" ? "warn" : "warn"}>{STATE_LABEL[state]}{state === "active" && x.consent?.expires_ms ? ` until ${new Date(x.consent.expires_ms).toLocaleDateString()}` : ""} for {model}</Badge>}
              {x?.evalScore !== undefined && <Badge kind="ok">score {x.evalScore}</Badge>}
            </div>
            <div className="mono">hash {short(s.hash, 16)}</div>
            {!forgotten && x?.committed && (
              <div className="row">
                <button disabled={!!busy || (state !== "none" && state !== "expired")} onClick={() => grant(s)}>{b("grant") ? "Sharing…" : `Share for ${days} days`}</button>
                <button disabled={!!busy || state === "none" || state === "pinned"} onClick={() => act(s.hash, "pin", () => call("pin_consent", args(s)))}>Pin</button>
                {state === "muted"
                  ? <button disabled={!!busy} onClick={() => act(s.hash, "resume", () => call("resume_consent", args(s)))}>Unmute</button>
                  : <button disabled={!!busy || (state !== "active" && state !== "pinned")} onClick={() => act(s.hash, "pause", () => call("pause_consent", args(s)))}>Mute</button>}
                <button disabled={!!busy || state === "none"} onClick={() => act(s.hash, "revoke", () => call("revoke_consent", args(s)))}>Revoke</button>
                {confirm === s.hash
                  ? <>
                      <span className="muted">Ends all use for good. Past rounds stay on record.</span>
                      <button className="btn-danger" disabled={!!busy} onClick={() => forget(s)}>{b("forget") ? "Forgetting…" : "Forget for good"}</button>
                      <button onClick={() => setConfirm("")}>Cancel</button>
                    </>
                  : <button disabled={!!busy} onClick={() => setConfirm(s.hash)}>Forget</button>}
              </div>)}
            {forgotten && (
              <div className="residue">
                <b>What remains after forgetting</b>
                <ul>{(s.residue ?? []).map((r, i) => <li key={i} className={r.measured ? "" : "unmeasured"}><span>{r.measured ? "Checked" : "Can't check"}</span> {r.detail}</li>)}</ul>
                {!s.residue && <p className="muted">Forgotten on another device, so the residue report isn't available here.</p>}
              </div>)}
          </div>
        );
      })}
    </div>
  );
}
