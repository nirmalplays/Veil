// Veil widget: a private AI chat any site can embed.
//   <script type="module" src="veil-widget.js" data-relay="https://relay.example.com" data-accent="#1f3a5f"></script>
// Before it lets a visitor type, it fetches the site's policy (master prompt + guardrails) and compares its hash with the one
// registered on NEAR. Messages are end-to-end encrypted in the browser to an attested NEAR AI enclave; the relay and the site only
// forward ciphertext. Nothing is stored: no cookies, no localStorage, and the conversation is gone when the tab closes.
import { NearAI, type ChatMessage } from "@client/nearai";
import { checkModelAttestation } from "@client/e2ee";
import { makeReceipt, redact, verifyReceipt, type Receipt } from "@client/receipt";
import { checkRules, describeRule, policyHash, type Policy } from "@client/policy";
import type { FullVerification } from "@client/verify";

interface Site { siteId: string; title: string; greeting: string; policy: Policy; fallback?: string; model: string; contract: string; receipts: "off" | "visitor"; maxTokens: number }
interface Registered { version: number; policy_hash: string; recorded_ms: number }
type Kept = { id: string; text: string; sent: ChatMessage[]; chat: Awaited<ReturnType<NearAI["chatE2EE"]>>; withheld?: string[] };
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
.m{max-width:88%;padding:8px 11px;border-radius:10px;white-space:pre-wrap;line-height:1.4} .m.user{align-self:flex-end;background:${accent};color:#fff} .m.assistant{align-self:flex-start;background:#fff;border:1px solid #dde}
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

  const bubble = (role: string, text: string) => { msgs.append(h("div", { class: `m ${role}`, textContent: text })); msgs.scrollTop = msgs.scrollHeight; };
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
      const r = await makeReceipt(ai, site.model, { id: k.chat.id, wire: k.chat.wire, attestation: k.chat.attestation }, { policy: site.policy, disclose: { messages: k.sent, reply: k.chat.text } });
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
      const sent: ChatMessage[] = [{ role: "system", content: site.policy.prompt }, ...thread];
      const r = await ai.chatE2EE(site.model, sent, { maxTokens: Math.min(2500, site.maxTokens), verify });
      const broke = r.text ? checkRules(site.policy.rules, r.text).filter((x) => !x.ok).map((x) => x.label) : [];
      // A reply that breaks a rule is never shown. The receipt for it still proves what happened, so the site cannot hide a violation.
      const reply = !r.text ? "I couldn't produce an answer that time. Please try again."
        : broke.length ? (site.fallback ?? "I can't answer that here. Please contact us directly.") : r.text;
      thread.push({ role: "assistant", content: reply }); bubble("assistant", reply);
      if (allow && r.text) kept.push({ id: r.id, text: reply, sent, chat: r, withheld: broke.length ? broke : undefined });
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
  }).catch((e) => { blocked = `Could not check the registered policy (${e instanceof Error ? e.message : e}).`; })
    .finally(() => { if (blocked) { note.className = "note err"; note.textContent = blocked; } render(); });
  render();
}

fetch(`${relay}/config`).then((r) => r.json()).then((s: Site) => boot(s)).catch((e) => console.error("veil-widget: could not load site config", e));
