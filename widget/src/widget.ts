// Veil widget: a private AI chat any site can embed.
//   <script type="module" src="veil-widget.js" data-relay="https://relay.example.com" data-accent="#1f3a5f"></script>
// Before it lets a visitor type, it fetches the site's policy (master prompt + guardrails) and compares its hash with the one
// registered on NEAR. Messages are end-to-end encrypted in the browser to an attested NEAR AI enclave; the relay and the site only
// forward ciphertext. Nothing is stored: no cookies, no localStorage, and the conversation is gone when the tab closes.
import { NearAI, type ChatMessage } from "@client/nearai";
import { checkModelAttestation } from "@client/e2ee";
import { makeReceipt, redact, verifyReceipt, type Receipt } from "@client/receipt";
import { checkRules, describeRule, policyHash, type Policy } from "@client/policy";
import { buildKbPrompt, kbEvidence, kbSemantic, retrieve, verifyKb, type KbChunk, type KbEvidence, type KbHit } from "@client/kb";
import { Embedder } from "@client/embed";
import type { FullVerification } from "@client/verify";

interface Site { siteId: string; title: string; greeting: string; policy: Policy; fallback?: string; model: string; contract: string; receipts: "off" | "visitor"; maxTokens: number }
interface Registered { version: number; policy_hash: string; recorded_ms: number }
type Kept = { id: string; text: string; sent: ChatMessage[]; chat: Awaited<ReturnType<NearAI["chatE2EE"]>>; withheld?: string[]; kb?: KbEvidence };
type Entry = { receipt: Receipt; ok: boolean };

const tag = document.querySelector<HTMLScriptElement>("script[data-relay]");
if (!tag) throw new Error("veil-widget: add data-relay to the script tag");
const demoRelay = location.hostname === "localhost" ? (window as unknown as { __relay?: string }).__relay : undefined;   // demo pages on localhost only
const relay = (demoRelay ?? tag.dataset.relay!).replace(/\/$/, "");
const rpcs = (tag.dataset.rpc ?? "https://test.rpc.fastnear.com,https://rpc.testnet.near.org").split(",");
const accent = tag.dataset.accent ?? "#1f3a5f";
const allowUnregistered = tag.dataset.allowUnregistered === "true";

async function registered(contract: string, siteId: string): Promise<Registered | null> {
  let last: unknown;
  for (const url of rpcs) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "w", method: "query",
        params: { request_type: "call_function", finality: "final", account_id: contract, method_name: "get_policy", args_base64: btoa(JSON.stringify({ site_id: siteId })) } }) });
      const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error.data ?? j.error));
      return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("NEAR RPC unreachable");
}

type Child = string | Node | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(t: K, p: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: Child[]) {
  const e = document.createElement(t); const { class: c, ...rest } = p as any;
  if (c) e.className = c; Object.assign(e, rest);
  for (const k of kids) if (k) e.append(k); return e;
}

const CSS = `
:host{all:initial} *{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
.fab{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;background:${accent};color:#fff;font-size:24px;cursor:pointer;box-shadow:0 4px 16px #0004;z-index:2147483000}
.panel{position:fixed;right:20px;bottom:88px;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100vh - 110px));background:#fff;color:#1c1c1c;border-radius:12px;box-shadow:0 8px 32px #0005;display:none;flex-direction:column;overflow:hidden;z-index:2147483000;font-size:14px}
.panel.open{display:flex}
header{background:${accent};color:#fff;padding:10px 14px} header b{font-size:15px} header .sub{font-size:12px;opacity:.9;margin-top:2px}
.msgs{flex:1;min-height:150px;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f6f7f8}
.m{max-width:88%;padding:8px 11px;border-radius:10px;white-space:pre-wrap;line-height:1.4} .m.user{align-self:flex-end;background:${accent};color:#fff} .src{align-self:flex-start;font-size:11.5px;color:#555;margin:-4px 0 0 4px} .m.assistant{align-self:flex-start;background:#fff;border:1px solid #dde}
.note{font-size:12px;color:#555;padding:0 12px 6px;background:#f6f7f8} .err{color:#b00020}
form{display:flex;gap:6px;padding:8px;border-top:1px solid #dde} input[type=text]{flex:1;padding:9px;border:1px solid #bbc;border-radius:8px;font-size:14px}
button.s{border:0;background:${accent};color:#fff;border-radius:8px;padding:0 14px;cursor:pointer} button:disabled{opacity:.5;cursor:default} input:disabled{background:#eee}
footer{font-size:12px;padding:6px 10px;border-top:1px solid #eee;display:flex;gap:10px;flex-wrap:wrap;align-items:center;color:#444}
footer button{border:0;background:none;color:${accent};text-decoration:underline;cursor:pointer;font-size:12px;padding:0}
.box{font-size:12px;padding:8px 12px;background:#fff;border-top:1px solid #eee;max-height:170px;overflow:auto} .box div{margin:3px 0} .ok{color:#0a6b2c} .bad{color:#b00020}
.box button{font-size:12px;margin-left:4px}
`;

function boot(site: Site) {
  const host = h("div"); const root = host.attachShadow({ mode: "open" });
  const ai = new NearAI("", `${relay}/v1`);
  const thread: ChatMessage[] = [];
  let kbChunks: KbChunk[] = [];   // this workspace's own knowledge base, accepted only if it rebuilds the registered root
  let busy = false, blocked = "", pol: Registered | null = null, enclave: FullVerification | undefined;
  let allow = false, showLog = false, showDetails = false;
  const kept: Kept[] = []; const log: Record<string, Entry> = {};

  let verifiedKey: string | undefined;
  const verify = async (report: unknown, nonce: string): Promise<FullVerification> => {
    const q = checkModelAttestation(report, nonce);
    // Later messages in a conversation reuse the key that was fully verified, so each message does not repeat the slow check.
    if (verifiedKey && q.ok && q.publicKey === verifiedKey && enclave) return { ...enclave, publicKey: verifiedKey };
    const { verifyModelAttestation } = await import("@client/verify");
    const f = await verifyModelAttestation(report, nonce, { nrasProxy: `${relay}/nras` });
    if (f.ok && f.publicKey) { verifiedKey = f.publicKey; enclave = f; }
    return f;
  };

  // Semantic retrieval: the question is embedded by an embedding model running in its own attested enclave, encrypted to it so neither this
  // site nor its relay can read the question. That enclave is fully verified once and its key pinned; the cosine ranking runs here.
  const sealedMode = site.policy.kb?.mode === "sealed";   // the knowledge base is never served to this page: the relay seals it to the enclave
  const sealCache = new Map<string, string>();
  /** Asks the relay to seal the knowledge base to this enclave key (which the browser has just verified). The result is opaque to this page. */
  const seal = async (modelKey: string): Promise<string> => {
    const hit = sealCache.get(modelKey); if (hit) return hit;
    const r = await fetch(`${relay}/seal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelKey }) });
    if (!r.ok) throw new Error(`the site could not seal its knowledge base to the enclave (${r.status})`);
    const { content } = (await r.json()) as { content: string }; sealCache.set(modelKey, content); return content;
  };
  const embedModel = sealedMode ? undefined : site.policy.kb?.embed?.model;
  let retrievalMode = embedModel ? "semantic" : "keyword";
  const embedder = embedModel ? new Embedder(ai, embedModel, async (report, nonce) => (await import("@client/verify")).verifyModelAttestation(report, nonce, { nrasProxy: `${relay}/nras` })) : undefined;

  const style = h("style", { textContent: CSS });
  const fab = h("button", { class: "fab", title: site.title, textContent: "💬" }); fab.setAttribute("aria-label", `Chat with ${site.title}`);
  const panel = h("div", { class: "panel" }); panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", site.title);
  const sub = h("div", { class: "sub" });
  const msgs = h("div", { class: "msgs" }); msgs.setAttribute("aria-live", "polite");
  const note = h("div", { class: "note" });
  const input = h("input", { type: "text", placeholder: "Type your message" }); input.setAttribute("aria-label", "Message");
  const send = h("button", { class: "s", type: "submit", textContent: "Send" });
  const form = h("form", {}, input, send);
  const box = h("div", { class: "box" });
  const foot = h("footer");
  panel.append(h("header", {}, h("b", { textContent: site.title }), sub), msgs, note, box, form, foot);
  root.append(style, fab, panel); document.body.append(host);

  const bubble = (role: string, text: string, sources?: string[]) => { msgs.append(h("div", { class: `m ${role}`, textContent: text })); if (sources?.length) msgs.append(h("div", { class: "src", textContent: `Sources: ${sources.join(", ")}` })); msgs.scrollTop = msgs.scrollHeight; };
  const ph = policyHash(site.policy);
  const fmt = (ms: number) => new Date(ms).toLocaleDateString();

  const render = () => {
    sub.textContent = blocked ? "Chat unavailable" : pol ? `Private AI · policy v${pol.version} registered on NEAR` : "Private AI · policy not registered";
    input.disabled = send.disabled = busy || !!blocked;
    box.style.display = showDetails || showLog ? "block" : "none"; box.replaceChildren();
    if (showDetails) {
      box.append(h("div", {}, "Your messages are encrypted in your browser to a secure enclave. This site and its relay see only ciphertext, and nothing is stored."));
      box.append(h("div", {}, `Policy hash ${ph.slice(0, 16)}… ` + (pol ? `(registered ${fmt(pol.recorded_ms)}, matches)` : "(not registered on NEAR)")));
      if (site.policy.rules?.length) {
        box.append(h("div", {}, "Every reply is checked against these rules before you see it:"));
        for (const r of site.policy.rules) box.append(h("div", { textContent: `• ${describeRule(r)}` }));
        box.append(h("div", {}, "Tone and judgement in the prompt cannot be checked this way, so they are not proven."));
      }
      if (sealedMode) box.append(h("div", {}, `Knowledge base: sealed (${site.policy.kb!.chunks} passages, fingerprint ${site.policy.kb!.root.slice(0, 12)}… registered on NEAR). The site's relay encrypts it to the enclave you verified, and this page only forwards the ciphertext, so you cannot read it and neither can the network. Only the enclave reads it. A visitor can still try to coax the model into repeating parts of it, which the rules above limit.`));
      if (site.policy.kb && !sealedMode) box.append(h("div", {}, `Knowledge base: ${site.policy.kb.chunks} passages, fingerprint ${site.policy.kb.root.slice(0, 12)}… ${kbChunks.length ? "(the copy loaded here matches the registered one)" : "(not loaded)"}. Answers cite the passages they used.`));
      if (site.policy.kb && !sealedMode) box.append(h("div", { class: embedder?.full ? "ok" : "" }, embedder
        ? `Search: ${retrievalMode}. Your question is matched to passages by an embedding model in its own attested enclave (encrypted to it, so this site and its relay cannot read it). ${embedder.full ? "That enclave was verified ✓ (Intel TDX, NVIDIA GPUs)." : "It is verified when you send your first message."}`
        : "Search: keyword matching in your browser."));
      box.append(h("div", {}, enclave ? "Enclave: " : "Enclave: not checked yet (checked when you send a message)."));
      for (const c of enclave?.checks ?? []) box.append(h("div", { class: c.state === "ok" ? "ok" : c.state === "failed" ? "bad" : "" , textContent: `${c.state === "ok" ? "✓" : c.state === "failed" ? "✗" : "–"} ${c.label}` }));
    }
    if (showLog) {
      box.append(h("b", { textContent: "Receipts" }));
      if (!kept.length) box.append(h("div", { textContent: "Answers you receive while receipts are allowed are listed here." }));
      for (const k of kept) {
        const e = log[k.id];
        const row = h("div", {}, k.withheld ? `Withheld (broke: ${k.withheld.join("; ")}) ` : `${k.text.slice(0, 40)}${k.text.length > 40 ? "…" : ""} `);
        if (!e) row.append(h("button", { textContent: "Get receipt", onclick: () => getReceipt(k) }));
        else row.append(h("span", { class: e.ok ? "ok" : "bad", textContent: e.ok ? "✓ signed " : "✗ invalid " }), h("button", { textContent: "Save proof", onclick: () => save(e.receipt, false) }), h("button", { textContent: "Save with content", onclick: () => save(e.receipt, true) }));
        box.append(row);
      }
    }
    foot.replaceChildren(h("button", { type: "button", textContent: showDetails ? "Hide details" : "How is this private?", onclick: () => { showDetails = !showDetails; render(); } }));
    if (site.receipts === "visitor") {
      const cb = h("input", { type: "checkbox", checked: allow }); cb.id = "allow";
      cb.addEventListener("change", () => { allow = cb.checked; if (!allow) { kept.length = 0; for (const k in log) delete log[k]; showLog = false; } render(); });
      const lab = h("label", {}, cb, " Allow receipts"); lab.htmlFor = "allow";
      foot.append(lab);
      if (allow) foot.append(h("button", { type: "button", textContent: `Receipt log (${kept.length})`, onclick: () => { showLog = !showLog; render(); } }));
    }
  };

  const getReceipt = async (k: Kept) => {
    try {
      const r = await makeReceipt(ai, site.model, { id: k.chat.id, wire: k.chat.wire, attestation: k.chat.attestation }, { policy: site.policy, kb: k.kb, disclose: { messages: k.sent, reply: k.chat.text } });
      log[k.id] = { receipt: r, ok: (await verifyReceipt(r)).ok };
    } catch (e) { note.textContent = `Could not get a receipt: ${e instanceof Error ? e.message : e}`; }
    render();
  };
  const save = (r: Receipt, withContent: boolean) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(withContent ? r : redact(r), null, 2)], { type: "application/json" }));
    a.download = `receipt-${r.id.slice(0, 8)}${withContent ? "-with-content" : ""}.json`; a.click();
  };

  fab.onclick = () => { panel.classList.toggle("open"); if (panel.classList.contains("open")) input.focus(); };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const text = input.value.trim(); if (!text || busy || blocked) return;
    input.value = ""; bubble("user", text); thread.push({ role: "user", content: text });
    busy = true; note.className = "note"; note.textContent = enclave ? "Thinking…" : "Checking the secure enclave, then encrypting your message… (the first message takes a few seconds)"; render();
    try {
      // Retrieval runs here, in the visitor's browser, so the question never reaches anyone unencrypted. The chosen chunks travel inside the encrypted request.
      let hits: KbHit[] = [];
      if (site.policy.kb && !sealedMode) {
        if (embedder) {
          try { const [qv] = await embedder.embed([text]); hits = kbSemantic(qv, kbChunks, 3); retrievalMode = "semantic"; }
          catch { hits = retrieve(text, kbChunks, 3); retrievalMode = "keyword (the embedding service was unavailable)"; }   // never blocks the answer
        } else hits = retrieve(text, kbChunks, 3);
      }
      // Sealed: the knowledge base is not in this list at all. chatE2EE slots in the relay's sealed ciphertext as the second message, once it has
      // verified the enclave. Receipts show a placeholder there, because this page never held the content.
      const policyMsg: ChatMessage = { role: "system", content: site.policy.prompt };
      const sent: ChatMessage[] = [policyMsg, ...(site.policy.kb && !sealedMode ? [{ role: "system" as const, content: buildKbPrompt(hits) }] : []), ...thread];
      const r = await ai.chatE2EE(site.model, sent, { maxTokens: Math.min(2500, site.maxTokens), verify, ...(sealedMode ? { sealed: seal, sealedAt: 1 } : {}) });
      if (sealedMode) sent.splice(1, 0, { role: "system", content: "[sealed knowledge base]" });
      const broke = r.text ? checkRules(site.policy.rules, r.text).filter((x) => !x.ok).map((x) => x.label) : [];
      // A reply that breaks a rule is never shown. The receipt for it still proves what happened, so the site cannot hide a violation.
      const reply = !r.text ? "I couldn't produce an answer that time. Please try again."
        : broke.length ? (site.fallback ?? "I can't answer that here. Please contact us directly.") : r.text;
      thread.push({ role: "assistant", content: reply }); bubble("assistant", reply, broke.length ? undefined : [...new Set(hits.map((x) => x.chunk.title))]);
      if (allow && r.text) kept.push({ id: r.id, text: reply, sent, chat: r, withheld: broke.length ? broke : undefined, kb: hits.length ? kbEvidence(hits.map((x) => x.index), kbChunks) : undefined });
      note.textContent = "";
    } catch (e) {
      thread.pop(); note.className = "note err"; note.textContent = `Sorry, something went wrong: ${e instanceof Error ? e.message : e}`;
    } finally { busy = false; render(); }
  };

  bubble("assistant", site.greeting);
  // Block the chat unless the policy served by the relay is exactly the one registered on NEAR.
  registered(site.contract, site.siteId).then((p) => {
    pol = p;
    if (!p && !allowUnregistered) blocked = "This site has not registered its policy on NEAR, so the chat is switched off.";
    else if (p && p.policy_hash.toLowerCase() !== policyHash(site.policy)) blocked = "This site's policy does not match the one registered on NEAR, so the chat is switched off.";
  }).then(async () => {
    if (blocked || !site.policy.kb || sealedMode) return;
    try {
      const r = await fetch(`${relay}/kb`); const j = (await r.json()) as { chunks?: KbChunk[] };
      if (!r.ok || !j.chunks) throw new Error(`the relay answered ${r.status}`);
      if (!verifyKb(j.chunks, site.policy.kb)) blocked = "This site's knowledge base does not match the one registered on NEAR (a passage was added, removed or changed), so the chat is switched off.";
      else kbChunks = j.chunks;
    } catch (e) { blocked = `Could not load the site's knowledge base (${e instanceof Error ? e.message : e}).`; }
  }).catch((e) => { blocked = `Could not check the registered policy (${e instanceof Error ? e.message : e}).`; })
    .finally(() => { if (blocked) { note.className = "note err"; note.textContent = blocked; } render(); });
  render();
}

/** Shown when the widget cannot start, so a visitor or the site owner sees why instead of an empty page. */
function problem(text: string, hint: string) {
  console.error(`veil-widget: ${text}`);
  const host = h("div"); const root = host.attachShadow({ mode: "open" });
  const fab = h("button", { class: "fab", textContent: "!" }); fab.setAttribute("aria-label", "Chat unavailable");
  const panel = h("div", { class: "panel open" });
  panel.append(h("header", {}, h("b", { textContent: "Chat unavailable" }), h("div", { class: "sub", textContent: text })), h("div", { class: "msgs" }, h("div", { class: "m assistant", textContent: hint })));
  fab.onclick = () => panel.classList.toggle("open");
  root.append(h("style", { textContent: CSS }), fab, panel); (document.body ?? document.documentElement).append(host);
}

const start = () => {
  fetch(`${relay}/config`)
    .then(async (r) => {
      if (r.status === 404) return problem("This site is not set up on the relay.", `The relay at ${relay} does not know this site. If you own it, save the workspace to the relay (Workspaces tab, “Save site to this relay”) and check the address in data-relay ends with /s/<your site id>.`);
      if (!r.ok) return problem(`The relay answered ${r.status}.`, "Ask the site owner to check the relay.");
      boot((await r.json()) as Site);
    })
    .catch(() => problem("Cannot reach the relay.", `Nothing answered at ${relay}. If you own this site, check that the relay is running and that data-relay is the right address.`));
};
if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
