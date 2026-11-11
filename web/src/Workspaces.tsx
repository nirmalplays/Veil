import { useEffect, useMemo, useRef, useState } from "react";
import { checkRules, policyHash } from "@client/policy";
import { KB_LIMITS, chunkDocuments, embedText, kbInfo, kbSemantic, passageKey, quantize, retrieve, type KbHit } from "@client/kb";
import { PRESETS, buildChunks, buildPolicy, buildSite, formProblems, indexStatus, validateSiteId, type SiteForm } from "@client/site";
import { NearAI } from "@client/nearai";
import { Embedder } from "@client/embed";
import { view } from "./chain";
import { call } from "./wallet";
import { CONTRACT } from "./config";
import { NEAR_MODEL, getNearKey, setNearKey } from "./nearKey";
import { verifyFull } from "./verifier";
import { Badge, errMsg, short } from "./ui";

/** A workspace is one site's AI: identity, greeting, policy (prompt and rules) and settings. Drafts live in this browser only. */
interface Draft { siteId: string; title: string; greeting: string; fallback: string; model: string; receipts: "off" | "visitor"; prompt: string; maxWordsText: string; mentionText: string; neverText: string; presets: string[]; docs?: { title: string; text: string }[]; /** Passage vectors computed in the TEE, keyed by passage content. */ vecs?: Record<string, string>; /** Who may read the documents: visitors' browsers (public), or only the enclave (sealed). */ kbMode?: "public" | "sealed" }
interface Registered { version: number; policy_hash: string; recorded_ms: number; uri: string }

const KEY = (a: string) => `veil:workspaces:${a}`;
const load = (a: string): Draft[] => { try { return JSON.parse(localStorage.getItem(KEY(a)) ?? "[]"); } catch { return []; } };
const store = (a: string, d: Draft[]) => { try { localStorage.setItem(KEY(a), JSON.stringify(d)); } catch { /* private mode */ } };
const lines = (t: string) => t.split("\n");

const template = (siteId: string): Draft => ({
  siteId, title: "", greeting: "Hello! I'm an AI assistant. How can I help?", fallback: "I can't answer that here. Please contact us directly.", model: NEAR_MODEL, receipts: "visitor",
  prompt: "You are the assistant for this business. Say that you are an AI. Be brief and polite. Never give professional advice; offer to connect the visitor with a person.",
  maxWordsText: "80", mentionText: "AI", neverText: "guarantee", presets: ["ssn"], docs: [],
});
const toForm = (d: Draft): SiteForm => ({ ...d, maxWords: d.maxWordsText.trim() ? Number(d.maxWordsText) : null, mustMention: lines(d.mentionText), mustNeverSay: lines(d.neverText), kbDocs: d.docs ?? [], kbVectors: d.vecs ?? {}, kbMode: d.kbMode ?? "public" });

const WIDGET_BASE = (import.meta.env.VITE_WIDGET_DEMO_URL as string | undefined)?.replace(/demo\/index\.html$/, "") ?? "http://localhost:5174/";

export function Workspaces({ account }: { account?: string }) {
  const [list, setList] = useState<Draft[]>([]);
  const [sel, setSel] = useState("");
  const [newId, setNewId] = useState("");
  const [relay, setRelay] = useState("http://localhost:8790");
  const [reg, setReg] = useState<{ latest: Registered | null; owner: string | null; history: Registered[] }>({ latest: null, owner: null, history: [] });
  const [sample, setSample] = useState("");
  const [ask, setAsk] = useState("");
  const [keyText, setKeyText] = useState(getNearKey());
  const [found, setFound] = useState<{ mode: string; hits: KbHit[] }>();
  const embedderRef = useRef<Embedder>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [checks, setChecks] = useState<{ ok: boolean; label: string; detail: string }[]>([]);
  const [fileThere, setFileThere] = useState<boolean | null>(null);
  useEffect(() => { fetch("/veil-widget.js", { method: "HEAD" }).then((r) => setFileThere(r.ok && !(r.headers.get("content-type") ?? "").includes("html")), () => setFileThere(false)); }, []);

  useEffect(() => { if (account) { const l = load(account); setList(l); setSel(l[0]?.siteId ?? ""); } }, [account]);
  const d = list.find((x) => x.siteId === sel);
  const form = d && toForm(d);
  const problems = form ? formProblems(form) : [];
  const policy = form && !problems.length ? buildPolicy(form) : undefined;
  const hash = useMemo(() => (policy ? policyHash(policy) : ""), [policy]);

  const update = (patch: Partial<Draft>) => { if (!account || !d) return; const l = list.map((x) => (x.siteId === d.siteId ? { ...x, ...patch } : x)); setList(l); store(account, l); };
  const create = () => {
    setErr(""); const id = newId.trim(); const bad = validateSiteId(id);
    if (bad) { setErr(bad); return; } if (!account) { setErr("Sign in first."); return; }
    if (list.some((x) => x.siteId === id)) { setErr("You already have a workspace with that id."); return; }
    const l = [...list, template(id)]; setList(l); store(account, l); setSel(id); setNewId("");
  };
  const remove = () => { if (!account || !d || !confirm(`Delete the draft "${d.siteId}" from this browser? Anything published on NEAR stays there.`)) return; const l = list.filter((x) => x.siteId !== d.siteId); setList(l); store(account, l); setSel(l[0]?.siteId ?? ""); };

  const refresh = async () => {
    if (!d || validateSiteId(d.siteId)) return;
    try {
      const [latest, owner, history] = await Promise.all([view<Registered | null>("get_policy", { site_id: d.siteId }), view<string | null>("policy_owner", { site_id: d.siteId }), view<Registered[]>("policy_history", { site_id: d.siteId })]);
      setReg({ latest, owner, history });
    } catch (e) { setErr(errMsg(e)); }
  };
  useEffect(() => { setReg({ latest: null, owner: null, history: [] }); setMsg(""); setErr(""); refresh(); }, [sel]);

  const taken = !!reg.owner && reg.owner !== account;
  const matches = !!reg.latest && reg.latest.policy_hash === hash;
  const publish = async () => {
    if (!policy || !d) return; setBusy(true); setErr(""); setMsg("");
    try {
      await call("publish_policy", { site_id: d.siteId, policy_hash: hash, uri: "" });
      setMsg("Published. Only the fingerprint goes on NEAR; the rules themselves are served by your relay."); setTimeout(refresh, 3500);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const siteJson = form && policy ? JSON.stringify(buildSite(form, CONTRACT), null, 2) : "";
  const saveToRelay = async () => {
    setErr(""); setMsg("");
    try {
      const r = await fetch("/__veil/save-site", { method: "POST", headers: { "Content-Type": "application/json", "X-Veil": "1" }, body: siteJson });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `save failed (${r.status})`);
      setMsg(`Saved to widget/sites/${d!.siteId}.json. The relay picks it up on the next request, no restart.`);
    } catch (e) { setErr(`${errMsg(e)} (This button only works with the local dev server. Otherwise download the file and put it in widget/sites/.)`); }
  };
  const download = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([siteJson], { type: "application/json" })); a.download = `${d!.siteId}.json`; a.click(); };
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => setMsg("Copied."), () => setErr("Copy failed; select the text instead."));
  const tested = policy && sample.trim() ? checkRules(policy.rules, sample) : [];
  const docs = d?.docs ?? [];
  const chunks = form ? buildChunks(form) : [];   // with vectors attached only when the index is complete
  const kb = chunks.length ? kbInfo(chunks, undefined, d?.kbMode ?? "public") : undefined;
  const idx = form ? indexStatus(form) : { total: 0, embedded: 0, complete: false };
  const setDoc = (i: number, patch: Partial<{ title: string; text: string }>) => update({ docs: docs.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const addFiles = async (files: FileList | null) => {
    if (!files) return; const add: { title: string; text: string }[] = [];
    for (const f of Array.from(files)) { if (f.size > KB_LIMITS.maxChars) { setErr(`${f.name} is too large (limit ${KB_LIMITS.maxChars.toLocaleString()} characters in total).`); continue; } add.push({ title: f.name.replace(/\.[^.]+$/, ""), text: await f.text() }); }
    update({ docs: [...docs, ...add] });
  };
  const key = () => { setNearKey(keyText); embedderRef.current = undefined; if (!getNearKey()) throw new Error("Enter your NEAR AI API key first. It stays in this tab and is never stored."); return getNearKey(); };

  /**
   * Embeds the passages that have no vector yet, inside the attested embedding enclave (the text is encrypted to the enclave's verified key).
   * The vectors are stored in this draft, become part of the registered fingerprint, and are served with the passages.
   */
  const buildIndex = async () => {
    if (!d) return; setErr(""); setMsg(""); setBusy(true);
    try {
      const emb = new Embedder(new NearAI(key()), undefined, verifyFull);
      const plain = chunkDocuments(docs.filter((x) => x.text.trim())); const have = d.vecs ?? {};
      const need = plain.filter((c) => !have[passageKey(c)]);
      const vs = await emb.embed(need.map(embedText));
      const next = { ...have }; need.forEach((c, i) => { next[passageKey(c)] = quantize(vs[i]); });
      update({ vecs: next });
      setMsg(`Embedded ${need.length} passage${need.length === 1 ? "" : "s"} in the attested enclave (${emb.full?.checks.filter((c) => c.state === "ok").length ?? 0} hardware checks passed). The fingerprint changed, so publish again.`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  /** Shows which passages a question would retrieve, using semantic search when the index is complete and a key is available. */
  const runAsk = async () => {
    if (!ask.trim() || !chunks.length) return; setErr("");
    try {
      if (idx.complete && (getNearKey() || keyText.trim())) {
        if (!embedderRef.current) embedderRef.current = new Embedder(new NearAI(key()), undefined, verifyFull);
        const [qv] = await embedderRef.current.embed([ask]);
        setFound({ mode: "semantic: your question was embedded in the attested enclave", hits: kbSemantic(qv, chunks, 3) });
      } else setFound({ mode: idx.complete ? "keyword (enter your NEAR AI key above to test semantic search)" : "keyword (no semantic index yet)", hits: retrieve(ask, chunks, 3) });
    } catch (e) { setErr(errMsg(e)); }
  };

  /** Walks the chain from this draft to a working preview and says which link is broken. */
  const checkSetup = async () => {
    if (!d || !policy) return; await refresh();
    const out: { ok: boolean; label: string; detail: string }[] = []; const add = (ok: boolean, label: string, detail: string) => out.push({ ok, label, detail });
    let cfg: { title: string; policy: Parameters<typeof policyHash>[0] } | undefined;
    try {
      const r = await fetch(`${relay}/s/${d.siteId}/config`);
      if (r.status === 404) add(false, "The relay has this site", "The relay is running but does not have it. Press “Save site to this relay”.");
      else if (!r.ok) add(false, "The relay has this site", `The relay answered ${r.status}.`);
      else { cfg = await r.json(); add(true, "The relay has this site", `serving “${cfg!.title}”`); }
    } catch { add(false, "The relay is running", `Nothing answered at ${relay}. Start it with npm run widget:relay, and check the address above.`); }
    if (cfg) {
      const rh = policyHash(cfg.policy);
      add(rh === hash, "The relay has your latest rules", rh === hash ? "same as this draft" : "The relay serves an older copy. Press “Save site to this relay” again.");
      try {
        const latest = await view<Registered | null>("get_policy", { site_id: d.siteId });
        add(!!latest && latest.policy_hash === rh, "The relay's rules are registered on NEAR", !latest ? "Nothing is published for this site id yet. Press “Publish to NEAR”." : latest.policy_hash === rh ? `published v${latest.version}` : `The relay's rules differ from published v${latest.version}. Publish this draft, or save the published one. The widget stays off until they match.`);
      } catch (e) { add(false, "The relay's rules are registered on NEAR", errMsg(e)); }
    }
    try { await fetch(`${WIDGET_BASE}demo/preview.html`, { mode: "no-cors" }); add(true, "The preview page is running", WIDGET_BASE); }
    catch { add(false, "The preview page is running", `Nothing answered at ${WIDGET_BASE}. Start it with npm run widget:demo.`); }
    setChecks(out);
  };

  if (!account) return <p className="muted">Sign in to create a workspace.</p>;
  const embed = d ? `<script defer src="https://YOUR-SITE/veil-widget.js"\n        data-relay="https://YOUR-RELAY/s/${d.siteId}" data-accent="#1f3a5f"></script>` : "";
  const preview = d ? `${WIDGET_BASE}demo/preview.html?relay=${encodeURIComponent(`${relay}/s/${d.siteId}`)}` : "";

  return (
    <div>
      <p className="muted">A workspace is one website's AI: its name, greeting, instructions and rules. You write them here, register their fingerprint on NEAR, and the widget on your site will only run while the live rules match it.</p>
      <div className="row">
        {list.length > 0 && <>Workspace <select value={sel} onChange={(e) => setSel(e.target.value)}>{list.map((x) => <option key={x.siteId}>{x.siteId}</option>)}</select></>}
        <input placeholder="new site id, e.g. acme-clinic" value={newId} onChange={(e) => setNewId(e.target.value.toLowerCase())} onKeyDown={(e) => e.key === "Enter" && create()} />
        <button className="btn-primary" onClick={create}>New workspace</button>
      </div>
      {list.length === 0 && <div className="guide"><b>Start here.</b> Pick a site id (lowercase letters, digits, dashes) and press “New workspace”. A sensible starting policy is filled in for you to edit.</div>}
      {err && <p className="err">{err}</p>}{msg && <p className="muted">{msg}</p>}

      {d && form && (
        <>
          <div className="card">
            <b>1. The assistant</b>
            <div className="row">Name shown in the chat <input value={d.title} placeholder="e.g. Acme Clinic" onChange={(e) => update({ title: e.target.value })} />
              Model <input value={d.model} onChange={(e) => update({ model: e.target.value })} style={{ width: 200 }} /></div>
            <div className="row">Greeting <input style={{ flex: 1 }} value={d.greeting} onChange={(e) => update({ greeting: e.target.value })} /></div>
            <div className="row">Shown instead of a reply that breaks a rule <input style={{ flex: 1 }} value={d.fallback} onChange={(e) => update({ fallback: e.target.value })} /></div>
            <div className="row">Receipts for visitors
              <select value={d.receipts} onChange={(e) => update({ receipts: e.target.value as "off" | "visitor" })}><option value="visitor">visitors may opt in</option><option value="off">off</option></select></div>
          </div>

          <div className="card">
            <b>2. Instructions (the master prompt)</b>
            <p className="muted">What the assistant is told. This is public on purpose: visitors can read it. A model can still ignore parts of it, so put anything that must hold in the rules below.</p>
            <textarea style={{ width: "100%", minHeight: 110 }} value={d.prompt} onChange={(e) => update({ prompt: e.target.value })} />
          </div>

          <div className="card">
            <b>3. Rules a program checks on every reply</b>
            <p className="muted">Unlike the instructions, these are enforced: the widget withholds a reply that breaks one, and a receipt proves whether each held.</p>
            <div className="row">At most <input type="number" min={1} style={{ width: 80 }} value={d.maxWordsText} onChange={(e) => update({ maxWordsText: e.target.value })} /> words (empty for no limit)</div>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label>Every reply must mention (one per line)<br /><textarea style={{ width: 260, minHeight: 60 }} value={d.mentionText} onChange={(e) => update({ mentionText: e.target.value })} /></label>
              <label>A reply must never say (one per line)<br /><textarea style={{ width: 260, minHeight: 60 }} value={d.neverText} onChange={(e) => update({ neverText: e.target.value })} /></label>
            </div>
            <div className="row">{Object.entries(PRESETS).map(([id, p]) => (
              <label key={id}><input type="checkbox" checked={d.presets.includes(id)} onChange={(e) => update({ presets: e.target.checked ? [...d.presets, id] : d.presets.filter((x) => x !== id) })} /> {p.label}</label>))}</div>
            <details><summary>Try the rules on a sample reply</summary>
              <textarea style={{ width: "100%", minHeight: 60 }} placeholder="Paste or type a reply to see which rules it would break" value={sample} onChange={(e) => setSample(e.target.value)} />
              {tested.map((r, i) => <div key={i}><Badge kind={r.ok ? "ok" : "bad"}>{r.ok ? "obeyed" : "broken"}</Badge> {r.label} <span className="muted">{r.detail}</span></div>)}
              {!policy && <p className="muted">Fix the problems above to test.</p>}</details>
          </div>

          <div className="card">
            <b>4. Knowledge base (optional, only for this workspace)</b>
            <p className="muted">Documents the assistant answers from: prices, hours, policies, FAQs. They are split into passages, hashed into one fingerprint that is registered with your policy, and the widget accepts only a copy that matches it. Retrieval runs in the visitor's browser so their question stays private. <b>Visitors' browsers can read these passages, so do not put secrets here.</b></p>
            {docs.map((x, i) => (
              <div key={i} className="row" style={{ alignItems: "flex-start" }}>
                <div><input placeholder="Title (shown as the source)" value={x.title} onChange={(e) => setDoc(i, { title: e.target.value })} style={{ width: 220 }} /><br />
                  <button onClick={() => update({ docs: docs.filter((_, j) => j !== i) })}>Remove</button></div>
                <textarea style={{ flex: 1, minWidth: 280, minHeight: 90 }} placeholder="Paste the text. Separate topics with a blank line." value={x.text} onChange={(e) => setDoc(i, { text: e.target.value })} />
              </div>))}
            <div className="row"><button onClick={() => update({ docs: [...docs, { title: "", text: "" }] })}>Add a document</button>
              <label>or upload text files <input type="file" multiple accept=".txt,.md,text/plain,text/markdown" onChange={(e) => addFiles(e.target.files)} /></label></div>
            {chunks.length > 0 && (
              <div className="row"><b>Who can read these documents?</b>
                <label><input type="radio" name={`mode-${d.siteId}`} checked={(d.kbMode ?? "public") === "public"} onChange={() => update({ kbMode: "public" })} /> Visitors' browsers (public)</label>
                <label><input type="radio" name={`mode-${d.siteId}`} checked={d.kbMode === "sealed"} onChange={() => update({ kbMode: "sealed" })} /> Sealed: only the enclave</label></div>)}
            {d.kbMode === "sealed" && chunks.length > 0 && (() => {
              const chars = chunks.reduce((n, c) => n + c.title.length + c.text.length, 0), tokens = Math.round(chars / 4);
              return <div className="card" style={{ margin: "10px 0" }}><b>Sealed knowledge base</b>
                <p className="muted">The relay encrypts all of it to the enclave's verified key, and visitors' browsers only forward the ciphertext. They cannot read it, and neither can the network. The model reads the whole thing for every question (the context window holds about a million tokens), so there is no search index to trust and no similarity cutoff to tune. It costs input tokens on every message: about <b>{tokens.toLocaleString()} tokens, roughly ${(tokens * 0.08 / 1e6).toFixed(4)} per message</b> at the cheapest model's price.</p>
                <p className="muted"><b>What it does not do.</b> It is hidden from the page and the network, not from a visitor who coaxes the model into repeating it, so treat it as "not published", not "secret". Visitors cannot check the passages against the registry; instead you can audit a receipt (see the README) to prove what was sealed. Your relay holds the plaintext, so it must be yours, with <span className="mono">SEAL_SECRET</span> set if you want audits to survive a restart.</p></div>;
            })()}
            {kb ? <div className="mono">{chunks.length} passages · fingerprint {short(kb.root, 12)}{kb.mode === "sealed" ? " · sealed" : ""}{kb.embed ? ` · semantic index (${kb.embed.dims} dimensions)` : ""}</div> : <p className="muted">No documents yet: the assistant will answer from its instructions alone.</p>}
            {idx.total > 0 && d.kbMode !== "sealed" && (
              <div className="card" style={{ margin: "10px 0" }}>
                <b>Semantic search (optional)</b>
                <p className="muted">Without it, questions are matched to passages by shared words. With it, an embedding model running in NEAR AI's attested TEE turns each passage and each visitor question into a vector, so "what do you charge for the first appointment?" finds a passage about the price of a first visit. The passages are embedded once, here; visitors' questions are embedded in the enclave, encrypted to it, so your site and relay never read them.</p>
                <div className="row"><input type="password" placeholder="NEAR AI API key (kept in this tab only)" value={keyText} onChange={(e) => { setKeyText(e.target.value); embedderRef.current = undefined; }} style={{ flex: 1 }} />
                  <button className="btn-primary" disabled={busy || !keyText.trim() || idx.complete} onClick={buildIndex}>{busy ? "Embedding…" : idx.complete ? "Index complete" : idx.embedded ? `Embed the ${idx.total - idx.embedded} new or changed passage${idx.total - idx.embedded === 1 ? "" : "s"}` : "Build semantic index in the TEE"}</button>
                  <Badge kind={idx.complete ? "ok" : "warn"}>{idx.embedded} of {idx.total} embedded</Badge></div>
                {idx.complete && <p className="muted">Changing the index changes the fingerprint: publish it again before saving the site to the relay.</p>}
              </div>)}
            {chunks.length > 0 && d.kbMode !== "sealed" && <details><summary>Try a question: which passages would be used?</summary>
              <div className="row"><input style={{ flex: 1 }} placeholder="e.g. How much does a first visit cost?" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runAsk()} /><button onClick={runAsk}>Test</button></div>
              {found && <p className="muted">Search: {found.mode}.</p>}
              {found && found.hits.length === 0 && <p className="muted">Nothing matched. The assistant would be told not to guess and to offer a person.</p>}
              {found?.hits.map((h, i) => <div key={i} className="msg assistant"><b>[{i + 1}] {h.chunk.title}</b> <span className="muted">score {h.score.toFixed(2)}</span><br />{h.chunk.text}</div>)}</details>}
          </div>

          <div className="card">
            <b>5. Register the fingerprint on NEAR</b>
            {problems.map((p, i) => <div key={i} className="err">{p}</div>)}
            {policy && <>
              <div className="mono">fingerprint {short(hash, 14)} <span className="muted">({policy.rules?.length ?? 0} rules{policy.kb ? `, ${policy.kb.chunks} knowledge passages` : ""})</span></div>
              <div className="row">
                {taken ? <Badge kind="bad">site id owned by {reg.owner}</Badge>
                  : !reg.latest ? <Badge kind="warn">not published yet</Badge>
                  : matches ? <Badge kind="ok">published v{reg.latest.version}, matches this draft</Badge>
                  : <Badge kind="warn">differs from published v{reg.latest.version}</Badge>}
                <button className="btn-primary" disabled={busy || taken || matches} onClick={publish}>{busy ? "Publishing…" : reg.latest ? "Publish as the next version" : "Publish to NEAR"}</button>
                <button onClick={refresh}>Refresh</button>
              </div>
              <p className="muted">{reg.latest && !matches ? "A widget whose rules differ from the latest published version switches itself off, so publish before you save the site to the relay." : "Registering makes you the owner of this site id. Only you can add versions; old ones stay visible."}</p>
              {reg.history.length > 0 && <details><summary>Version history ({reg.history.length})</summary>
                {reg.history.map((h) => <div key={h.version} className="mono">v{h.version} {short(h.policy_hash, 10)} <span className="muted">{new Date(h.recorded_ms).toLocaleString()}</span></div>)}</details>}
            </>}
          </div>

          <div className="card">
            <b>6. Put it on your site</b>
            {!policy ? <p className="muted">Complete the steps above first.</p> : <>
              <div className="row">Relay <input style={{ width: 240 }} value={relay} onChange={(e) => setRelay(e.target.value)} />
                <button onClick={saveToRelay}>Save site to this relay (local dev)</button><button onClick={download}>Download site.json</button></div>
              <p className="muted">The relay holds the API key and forwards only encrypted requests, so neither it nor you can read visitors' conversations. Start it with <span className="mono">npm run widget:relay</span>.</p>
              <div className="row"><a className="btn-primary" style={{ padding: "6px 12px", borderRadius: 4, textDecoration: "none", color: "#fff" }} href={preview} target="_blank" rel="noreferrer">Open a live preview</a>
                <span className="muted">needs <span className="mono">npm run widget:demo</span> and the relay running</span></div>
              <div className="row"><button onClick={checkSetup}>Check my setup</button><span className="muted">finds which step is missing if the preview does not work</span></div>
              {checks.map((c, i) => <div key={i}><Badge kind={c.ok ? "ok" : "bad"}>{c.ok ? "ok" : "fix"}</Badge> {c.label} <span className="muted">{c.detail}</span></div>)}
              <details open><summary><b>Put it on your own website</b></summary>
                <ol className="muted">
                  <li>Download the widget file and upload it to your website's files (it is one JavaScript file, about 160 KB compressed). {fileThere === false && <span className="err">It has not been built yet: run <span className="mono">npm run widget:build</span>, then reload this page.</span>}
                    <div className="row"><a className="btn-primary" style={{ padding: "6px 12px", borderRadius: 4, textDecoration: "none", color: "#fff" }} href="/veil-widget.js" download="veil-widget.js">Download veil-widget.js</a></div></li>
                  <li>Run the relay somewhere public over HTTPS (it holds your API key and forwards only encrypted messages), and save this site to it.</li>
                  <li>Paste this before the closing &lt;/body&gt; tag of your pages, with your own addresses:<pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{embed}</pre><button onClick={() => copy(embed)}>Copy</button></li>
                </ol>
              </details>
            </>}
          </div>
          <div className="row"><button className="btn-danger" onClick={remove}>Delete this draft</button></div>
        </>
      )}
    </div>
  );
}
