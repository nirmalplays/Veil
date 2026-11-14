import { addCopyButtons, chrome, codeBlock, esc, mark, RELAY } from "./chrome";
import { initFx, decrypt } from "./fx";
import { STAGES, type FlowEvent, type StageId } from "./flow-meta";
import { e2eeEncryptKeep } from "../../client/src/e2ee.js";
import { describeRule, policyHash, type Policy } from "../../client/src/policy.js";
import "./home.css";

chrome("home");
interface Recording { recordedAt: string; relay: string; question: string; answer: string; events: FlowEvent[] }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const rec: Promise<Recording | null> = fetch("./recorded-run.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);

// ---------- hero: live encryption to the attested key from the recorded run ----------
const FALLBACK_KEY = "5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff";
const input = $<HTMLInputElement>("plain"), out = $("cipher-out"), meta = $("cipher-meta");
let key = FALLBACK_KEY, keyNote = "an enclave key verified on Intel TDX + NVIDIA";
let lastCipher = "";
const encrypt = () => {
  const text = input.value;
  if (!text) { out.textContent = "Type something. Nothing leaves this tab."; out.classList.add("empty"); meta.textContent = ""; lastCipher = ""; window.dispatchEvent(new Event("veil:plain")); return; }
  out.classList.remove("empty");
  const c = e2eeEncryptKeep(text, key).data;
  lastCipher = c;
  out.textContent = c;
  meta.innerHTML = `${new TextEncoder().encode(text).length} bytes → ${c.length / 2} bytes · XChaCha20-Poly1305 · to ${esc(keyNote)} <span class="k">${key.slice(0, 10)}…</span>`;
  window.dispatchEvent(new Event("veil:plain"));
};
let pending = 0;
input.addEventListener("input", () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(encrypt); });
encrypt();
// a slow shimmer: the same words, re-encrypted with a new one-time key every few seconds, so the noise never repeats
setInterval(() => { if (document.activeElement !== input && input.value && !document.hidden) encrypt(); }, 3200);

// ---------- the path: real values from the recording ----------
const stageSummary = (id: StageId, evs: FlowEvent[]): string => {
  const okN = evs.filter((e) => e.kind === "ok").length;
  const pick = (k: FlowEvent["kind"]) => evs.find((e) => e.kind === k);
  switch (id) {
    case "wake": return pick("ok")?.text.replace(/: site.*/, "") ?? "";
    case "policy": return (evs.find((e) => e.kind === "data")?.data ?? "").slice(0, 16) + "… matches NEAR";
    case "relay-tee": return pick("warn") ? "Not a TEE, and it says so" : `${okN} checks`;
    case "attest": return pick("ok")?.text.replace("Attestation received: ", "") ?? "";
    case "verify": return `${okN - 1} hardware checks passed`;
    case "encrypt": return evs[1]?.text.replace("Encrypted your message: ", "") ?? "";
    case "send": return evs.find((e) => e.kind === "ok")?.text.replace("Encrypted answer back in ", "answer in ") ?? "";
    case "decrypt": return "only in your browser";
    case "rules": return `${evs.filter((e) => e.kind === "ok").length - 1} of ${evs.length - 1} rules hold`;
    case "receipt": return `${okN - 1} receipt checks passed`;
  }
};
const icon = (k: FlowEvent["kind"]) => (k === "ok" ? "✓" : k === "fail" ? "✗" : k === "warn" ? "!" : k === "step" ? "→" : k === "data" ? "◆" : "·");

rec.then((r) => {
  const list = $("path-list");
  if (!r) { list.innerHTML = `<li class="muted">The recorded run could not be loaded. <a href="./live.html">Run it live instead.</a></li>`; return; }
  $("path-when").textContent = `Recorded ${new Date(r.recordedAt).toUTCString().replace(" GMT", " UTC")} · question: “${r.question}”`;
  list.innerHTML = STAGES.map((s, i) => {
    const evs = r.events.filter((e) => e.stage === s.id);
    const t = evs[0] ? `+${(evs[0].t / 1000).toFixed(2)}s` : "";
    const state = evs.some((e) => e.kind === "fail") ? "fail" : evs.some((e) => e.kind === "warn") ? "warn" : "ok";
    return `<li class="path-row" data-in="${Math.min(i * 0.03, 0.2)}">
      <button class="path-btn" type="button" aria-expanded="false" aria-controls="ps-${s.id}">
        <span class="n mono">${String(i + 1).padStart(2, "0")}</span>
        <span class="t">${s.title}</span>
        <span class="v mono ${state}">${esc(stageSummary(s.id, evs))}</span>
        <span class="time mono">${t}</span>
      </button>
      <div class="path-log" id="ps-${s.id}" hidden>
        <p class="muted">${s.what}</p>
        <ol class="mini-log mono">${evs.map((e) => `<li class="${e.kind}"><span>${icon(e.kind)}</span><span>${esc(e.text)}</span></li>`).join("")}</ol>
      </div>
    </li>`;
  }).join("");
  list.querySelectorAll<HTMLButtonElement>(".path-btn").forEach((b) => b.addEventListener("click", () => {
    const open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open)); (b.nextElementSibling as HTMLElement).hidden = open;
  }));
  const pin = r.events.find((e) => e.text.startsWith("Pinned the enclave key"));
  if (pin?.data) { key = pin.data; keyNote = `the enclave key verified ${new Date(r.recordedAt).toISOString().slice(0, 10)}`; encrypt(); }
  fx.add(() => {});
});

// ---------- who sees what ----------
type Cell = { state: "plain" | "cipher" | "none" | "public" | "meta"; text: string };
const ITEMS = ["Your message", "The answer", "The site's API key", "The site's rules", "Metadata"];
const PARTIES: { id: string; name: string; note: string; cells: () => Cell[] }[] = [
  { id: "you", name: "You", note: "Everything starts and ends in your browser tab. Nothing is stored there either: close the tab and it's gone.",
    cells: () => [{ state: "plain", text: input.value || "(type in the box above)" }, { state: "plain", text: "Decrypted here, with a one-time key only this tab holds." }, { state: "none", text: "Never sent to you." }, { state: "public", text: "Public, and checked against NEAR." }, { state: "meta", text: "Yours." }] },
  { id: "relay", name: "The site's relay", note: "The relay is the site owner's small server. It adds the API key and forwards bytes it cannot open.",
    cells: () => [{ state: "cipher", text: lastCipher }, { state: "cipher", text: "Ciphertext, encrypted to your one-time key." }, { state: "plain", text: "Holds it, so your browser never needs one." }, { state: "public", text: "Serves them. A change would not match NEAR." }, { state: "meta", text: "Time, IP address, message size." }] },
  { id: "host", name: "Its hosting company", note: "This demo's relay runs on ordinary hosting, not in a TEE, so the host could read the API key. Your messages are still out of reach.",
    cells: () => [{ state: "cipher", text: lastCipher }, { state: "cipher", text: "Ciphertext." }, { state: "plain", text: "Could read it. No TEE here, and the widget says so." }, { state: "public", text: "Public." }, { state: "meta", text: "Time, IP address, message size." }] },
  { id: "net", name: "The network", note: "Wi-Fi owners, ISPs and anyone in between see TLS, and inside it, more ciphertext.",
    cells: () => [{ state: "cipher", text: lastCipher }, { state: "cipher", text: "Ciphertext inside TLS." }, { state: "none", text: "Inside TLS." }, { state: "public", text: "Public." }, { state: "meta", text: "That you connected, and when." }] },
  { id: "enclave", name: "The AI enclave", note: "The model runs inside Intel TDX with NVIDIA GPUs in confidential mode. It reads your message there, and your browser verified that hardware first.",
    cells: () => [{ state: "plain", text: input.value ? `${input.value} (inside verified hardware only)` : "Plaintext, inside verified hardware only." }, { state: "plain", text: "Writes it, then encrypts it to you." }, { state: "none", text: "Not needed." }, { state: "plain", text: "Receives the prompt with your message." }, { state: "meta", text: "Only the request itself." }] },
  { id: "near", name: "NEAR blockchain", note: "The chain never sees conversations. It holds a fingerprint of the site's rules, so anyone can check they did not change.",
    cells: () => [{ state: "none", text: "Nothing." }, { state: "none", text: "Nothing." }, { state: "none", text: "Nothing." }, { state: "public", text: "Only their SHA-256 fingerprint." }, { state: "none", text: "Nothing." }] },
];
let party = "relay";
const tabs = $("who-tabs"), grid = $("who-grid"), note = $("who-note");
tabs.innerHTML = PARTIES.map((p) => `<button class="chip" role="tab" type="button" id="tab-${p.id}" aria-selected="${p.id === party}" aria-pressed="${p.id === party}" data-p="${p.id}">${p.name}</button>`).join("");
const LABEL: Record<Cell["state"], string> = { plain: "Readable", cipher: "Ciphertext", none: "Nothing", public: "Public", meta: "Metadata" };
const renderWho = (animate = true) => {
  const p = PARTIES.find((x) => x.id === party)!;
  grid.setAttribute("aria-labelledby", `tab-${p.id}`);
  grid.innerHTML = p.cells().map((c, i) => `<div class="who-cell ${c.state}"><span class="eyebrow">${ITEMS[i]}</span><span class="who-state mono">${LABEL[c.state]}</span><p class="${c.state === "cipher" ? "mono hex" : ""}">${esc(c.state === "cipher" && c.text.length > 120 ? c.text.slice(0, 120) + "…" : c.text)}</p></div>`).join("");
  note.textContent = p.note;
  if (animate) grid.querySelectorAll<HTMLElement>(".who-cell.cipher .hex").forEach((h) => decrypt(h, h.textContent ?? "", 18));
};
tabs.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-p]"); if (!b) return;
  party = b.dataset.p!; tabs.querySelectorAll("button").forEach((x) => { x.setAttribute("aria-selected", String(x === b)); x.setAttribute("aria-pressed", String(x === b)); });
  renderWho();
});
tabs.addEventListener("keydown", (e) => {
  const bs = [...tabs.querySelectorAll<HTMLButtonElement>("button")], i = bs.findIndex((b) => b.dataset.p === party);
  const j = e.key === "ArrowRight" ? (i + 1) % bs.length : e.key === "ArrowLeft" ? (i - 1 + bs.length) % bs.length : -1;
  if (j >= 0) { e.preventDefault(); bs[j].click(); bs[j].focus(); }
});
window.addEventListener("veil:plain", () => renderWho(false));
renderWho(false);

// ---------- live rules from the relay ----------
const rulesEl = $("rules");
fetch(`${RELAY}/s/harbor-law-demo/config`).then((r) => r.json()).then((s: { policy: Policy }) => {
  rulesEl.innerHTML = (s.policy.rules ?? []).map((r) => `<li><span class="ok">✓</span>${esc(describeRule(r))}</li>`).join("") + `<li><span class="muted">·</span><span class="muted">Plus a master prompt: ${esc(s.policy.prompt.slice(0, 120))}…</span></li>`;
  $("rules-hash").textContent = `fingerprint ${policyHash(s.policy)}`;
}).catch(() => { rulesEl.innerHTML = `<li class="muted">The relay is waking up (free hosting sleeps when idle). Reload in a minute.</li>`; });
$("open-chat").addEventListener("click", () => {
  const host = [...document.body.children].find((el) => el.shadowRoot?.querySelector(".fab"));
  const fab = host?.shadowRoot?.querySelector<HTMLButtonElement>(".fab");
  if (fab) { fab.click(); } else { $("open-chat").textContent = "The chat is still loading…"; setTimeout(() => ($("open-chat").textContent = "Open the chat"), 2000); }
});

// ---------- embed snippet ----------
$("embed-code").innerHTML = codeBlock("index.html", `<script defer src="https://your-site.com/veil-widget.js"
  data-relay="${RELAY}/s/<your-site-id>"
  data-accent="#6b2bb8"></script>`);
addCopyButtons();

$("final-mark").innerHTML = mark(112);
const fx = initFx();
