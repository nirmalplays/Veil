import { addCopyButtons, chrome, codeBlock, esc, RELAY } from "./chrome";
import { initFx } from "./fx";
import { clipHtml, initClips } from "./media";
import { checkRules, type Rule } from "../../client/src/policy.js";
import "./docs.css";

chrome("docs");
document.getElementById("docs-clip")!.innerHTML = clipHtml("chat", "inline");
initFx();
initClips();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- table of contents, scroll tracking, search ----------
const sections = [...document.querySelectorAll<HTMLElement>(".doc > section")];
const toc = $("toc");
let html = "", group = "";
for (const s of sections) {
  if (s.dataset.group !== group) { html += `${group ? "</ul>" : ""}<p class="toc-g eyebrow">${s.dataset.group}</p><ul>`; group = s.dataset.group!; }
  html += `<li><a href="#${s.id}" data-for="${s.id}">${esc(s.querySelector("h2")!.textContent!)}</a></li>`;
}
toc.innerHTML = html + "</ul>";
const links = new Map([...toc.querySelectorAll<HTMLAnchorElement>("a")].map((a) => [a.dataset.for!, a]));
const spy = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  links.forEach((a) => a.removeAttribute("aria-current")); links.get(e.target.id)?.setAttribute("aria-current", "true");
}), { rootMargin: "-30% 0px -65% 0px" });
sections.forEach((s) => spy.observe(s));

const find = $<HTMLInputElement>("find");
const none = document.createElement("p"); none.className = "no-hits muted"; none.hidden = true; $("doc").prepend(none);
find.addEventListener("input", () => {
  const q = find.value.trim().toLowerCase();
  let hits = 0;
  for (const s of sections) {
    const show = !q || s.textContent!.toLowerCase().includes(q);
    s.hidden = !show; links.get(s.id)!.parentElement!.hidden = !show; if (show) hits++;
  }
  toc.querySelectorAll<HTMLElement>(".toc-g").forEach((g) => { const ul = g.nextElementSibling as HTMLElement; g.hidden = ![...ul.children].some((li) => !(li as HTMLElement).hidden); });
  none.hidden = hits > 0; none.textContent = `Nothing matches “${find.value}”. Try “relay”, “receipt” or “rules”.`;
});
addEventListener("keydown", (e) => { if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { e.preventDefault(); find.focus(); } });

// ---------- embed generator ----------
const gen = () => {
  const relay = $<HTMLInputElement>("g-relay").value.trim().replace(/\/$/, "") || RELAY;
  const site = $<HTMLInputElement>("g-site").value.trim() || "<your-site-id>";
  const accent = $<HTMLInputElement>("g-accent").value;
  $("g-accent-v").textContent = accent;
  const unreg = $<HTMLInputElement>("g-unreg").checked ? `\n  data-allow-unregistered="true"` : "";
  $("gen-out").innerHTML = codeBlock("your page", `<script defer src="/veil-widget.js"\n  data-relay="${relay}/s/${site}"\n  data-accent="${accent}"${unreg}></script>`);
  addCopyButtons($("gen-out"));
};
$("gen").addEventListener("input", gen); $("gen").addEventListener("submit", (e) => e.preventDefault()); gen();

// ---------- rule tester ----------
const rules: Rule[] = [{ type: "max_words", n: 80 }, { type: "must_include", text: "AI" }, { type: "must_not_include", text: "guarantee" }, { type: "must_not_match", pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b", label: "social security number" }];
const NAMES: Record<Rule["type"], string> = { max_words: "At most … words", must_include: "Must mention", must_not_include: "Must never say", must_not_match: "Must not match (regex)" };
const tr = $("t-rules");
tr.innerHTML = rules.map((r, i) => {
  const v = r.type === "max_words" ? r.n : r.type === "must_not_match" ? r.pattern : r.text;
  return `<label class="t-rule"><span class="mono">${NAMES[r.type]}</span><input data-i="${i}" ${r.type === "max_words" ? 'type="number" min="1" max="2000"' : 'type="text"'} value="${esc(String(v))}"></label>`;
}).join("");
const test = () => {
  const res = checkRules(rules, $<HTMLTextAreaElement>("t-reply").value);
  const bad = res.filter((r) => !r.ok).length;
  $("t-results").innerHTML = res.map((r) => `<li class="${r.ok ? "ok" : "fail"}"><span>${r.ok ? "✓" : "✗"}</span><span>${esc(r.label)}</span><span class="muted">${esc(r.detail)}</span></li>`).join("")
    + `<li class="${bad ? "fail" : "ok"} verdict"><span>${bad ? "✗" : "✓"}</span><span>${bad ? `The widget would hide this reply (${bad} rule${bad > 1 ? "s" : ""} broken) and show the fallback.` : "The widget would show this reply."}</span><span></span></li>`;
};
tr.addEventListener("input", (e) => {
  const inp = e.target as HTMLInputElement, i = +inp.dataset.i!, r = rules[i];
  if (r.type === "max_words") r.n = Math.max(1, +inp.value || 1); else if (r.type === "must_not_match") r.pattern = inp.value; else r.text = inp.value;
  test();
});
$("t-reply").addEventListener("input", test); test();

// ---------- relay API, with live calls ----------
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
const API: { m: string; p: string; d: string; tryPath?: () => string }[] = [
  { m: "GET", p: "/config", d: "The site's public settings: title, greeting, policy (prompt and rules), model, contract. Secrets and limits are left out.", tryPath: () => "/s/harbor-law-demo/config" },
  { m: "GET", p: "/kb", d: "The public knowledge-base passages, if the site has one. 404 when there is none, or when it is sealed.", tryPath: () => "/s/harbor-law-demo/kb" },
  { m: "GET", p: "/relay-attestation?nonce=<64 hex>", d: "Proof the relay runs in a TEE: an Intel TDX quote carrying your nonce. 501 on ordinary hosting.", tryPath: () => `/relay-attestation?nonce=${nonce()}` },
  { m: "GET", p: "/v1/attestation/report", d: "Forwards to NEAR AI: the model's attestation for your nonce (about 800 KB). This is what the browser verifies before encrypting." },
  { m: "POST", p: "/v1/chat/completions", d: "Forwards an end-to-end encrypted chat. Refused unless every message is encrypted and the model is the site's. The body is never rewritten." },
  { m: "GET", p: "/v1/signature/<id>", d: "The enclave's signature over a finished chat, for receipts." },
  { m: "POST", p: "/v1/embeddings", d: "Encrypted embeddings for semantic search. Only the site's embedding model is allowed." },
  { m: "POST", p: "/nras/v3/attest/gpu", d: "Forwards GPU evidence to NVIDIA, which refuses browsers. It can't change the verdict: the signed token is checked in the browser against NVIDIA's keys." },
  { m: "POST", p: "/seal", d: "Seals a sealed knowledge base to an enclave key, only after the relay has verified that key itself." },
  { m: "POST", p: "/audit", d: "Owner only (Bearer AUDIT_TOKEN): reproduces what was sealed for a given enclave key, to attach to a receipt." },
];
$("api-list").innerHTML = API.map((a, i) => `<div class="api-row">
  <div class="api-top"><span class="verb mono ${a.m.toLowerCase()}">${a.m}</span><code>${esc(a.p)}</code>${a.tryPath ? `<button class="btn sm ghost" type="button" data-try="${i}">Try it</button>` : ""}</div>
  <p>${esc(a.d)}</p><div class="api-out" id="api-out-${i}" hidden></div></div>`).join("");
$("api-list").addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-try]"); if (!b) return;
  const i = +b.dataset.try!, out = $(`api-out-${i}`), path = API[i].tryPath!();
  out.hidden = false; b.disabled = true;
  const t0 = performance.now();
  out.innerHTML = `<p class="mono muted">GET ${esc(RELAY + path)} … (a sleeping relay takes up to a minute to wake)</p>`;
  try {
    const r = await fetch(RELAY + path), text = await r.text();
    let body = text; try { body = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not json */ }
    out.innerHTML = `<p class="mono"><span class="${r.ok ? "ok" : "warn"}">${r.status}</span> in ${((performance.now() - t0) / 1000).toFixed(2)} s</p><pre>${esc(body.length > 3000 ? body.slice(0, 3000) + "\n…" : body)}</pre>`;
  } catch (err) { out.innerHTML = `<p class="mono fail">Could not reach the relay: ${esc(String(err))}</p>`; }
  finally { b.disabled = false; }
});
