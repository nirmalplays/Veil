import { chrome, esc, RELAY } from "./chrome";
import { initFx, reduced } from "./fx";
import { NODES, STAGES, type FlowEvent, type Kind, type NodeId, type StageId } from "./flow-meta";
import "./live.css";

chrome("live");
initFx();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SVGNS = "http://www.w3.org/2000/svg";

// ---------- diagram ----------
const POS: Record<NodeId, [number, number]> = { near: [250, 95], you: [118, 340], relay: [373, 340], gateway: [628, 340], enclave: [883, 340], intel: [250, 585], nvidia: [505, 585] };
const EDGES: [NodeId, NodeId][] = [["you", "relay"], ["relay", "gateway"], ["gateway", "enclave"], ["you", "near"], ["you", "intel"], ["relay", "nvidia"]];
const ek = (a: NodeId, b: NodeId) => [a, b].sort().join("-");
const net = $<SVGSVGElement & HTMLElement>("net") as unknown as SVGSVGElement;
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) => {
  const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); parent?.appendChild(e); return e;
};
net.insertAdjacentHTML("beforeend", `<defs>
  <filter id="glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0v7" stroke="rgba(157, 134, 255, .22)" stroke-width="2"/></pattern>
</defs>`);
const gEdges = el("g", {}, net), gPk = el("g", {}, net), gNodes = el("g", {}, net);
const edgeEls = new Map<string, SVGLineElement>();
for (const [a, b] of EDGES) edgeEls.set(ek(a, b), el("line", { x1: POS[a][0], y1: POS[a][1], x2: POS[b][0], y2: POS[b][1], class: "edge" }, gEdges) as SVGLineElement);
const nodeEls = new Map<NodeId, SVGGElement>();
(Object.keys(POS) as NodeId[]).forEach((id) => {
  const [x, y] = POS[id], w = 226, h = 104;
  const g = el("g", { class: `node n-${id}`, transform: `translate(${x - w / 2} ${y - h / 2})` }, gNodes) as SVGGElement;
  el("rect", { width: w, height: h, rx: 24, class: "box" }, g);
  if (id === "enclave") { el("rect", { width: w, height: h, rx: 24, fill: "url(#hatch)" }, g); el("rect", { x: 6, y: 6, width: w - 12, height: h - 12, rx: 19, class: "inner" }, g); }
  const t = el("text", { x: 20, y: 44, class: "nl" }, g); t.textContent = NODES[id].label;
  const s = el("text", { x: 20, y: 74, class: "ns" }, g); s.textContent = NODES[id].sub.length > 22 ? NODES[id].sub.slice(0, 21) + "…" : NODES[id].sub;
  el("circle", { cx: w - 22, cy: 24, r: 7, class: "dot" }, g);
  nodeEls.set(id, g);
});

let speed = 1;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function packet(path: NodeId[], kind: Kind) {
  if (reduced || path.length < 2) return;
  const c = el("circle", { r: 9, class: `pk ${kind}`, filter: "url(#glow)" }, gPk);
  const seg = 520 / Math.max(speed, 1);
  let i = 0, start = performance.now();
  const step = (now: number) => {
    const a = path[i], b = path[i + 1], line = edgeEls.get(ek(a, b));
    const p = Math.min((now - start) / seg, 1), e = 1 - Math.pow(1 - p, 3);
    const [x1, y1] = POS[a], [x2, y2] = POS[b];
    c.setAttribute("cx", String(x1 + (x2 - x1) * e)); c.setAttribute("cy", String(y1 + (y2 - y1) * e));
    line?.classList.add("hot");
    if (p >= 1) { setTimeout(() => line?.classList.remove("hot"), 260); i++; start = now; if (i >= path.length - 1) { c.remove(); return; } }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function ping(id: NodeId, kind: Kind) {
  const g = nodeEls.get(id); if (!g) return;
  g.classList.remove("ping"); void g.getBoundingClientRect(); g.classList.add("ping");
  if (kind === "fail") g.dataset.state = "fail";
  else if (kind === "warn" && g.dataset.state !== "fail") g.dataset.state = "warn";
  else if (kind === "ok" && !g.dataset.state) g.dataset.state = "ok";
}

// ---------- lens ----------
type Lens = "all" | NodeId;
const LENSES: { id: Lens; label: string }[] = [{ id: "all", label: "Everyone" }, { id: "you", label: "You" }, { id: "relay", label: "Relay" }, { id: "gateway", label: "Gateway" }, { id: "enclave", label: "Enclave" }, { id: "near", label: "NEAR" }];
let lens: Lens = "all";
const lensBox = $("lens");
lensBox.innerHTML = LENSES.map((l) => `<button class="chip" type="button" aria-pressed="${l.id === lens}" data-l="${l.id}">${l.label}</button>`).join("");
lensBox.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-l]"); if (!b) return;
  lens = b.dataset.l as Lens; lensBox.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); applyLens();
});
const sees = (e: FlowEvent, l: Lens) => l === "all" || !e.data || (e.visibleTo ?? ["you"]).includes(l);
function applyLens() {
  nodeEls.forEach((g, id) => g.classList.toggle("dim", lens !== "all" && id !== lens));
  log.querySelectorAll<HTMLLIElement>("li[data-i]").forEach((li) => li.classList.toggle("hidden-from", !sees(events[+li.dataset.i!], lens)));
  const withData = events.filter((e) => e.data), seen = withData.filter((e) => sees(e, lens));
  const name = LENSES.find((l) => l.id === lens)!.label;
  $("lens-note").textContent = lens === "all" ? "Pick a party to see only what it could read. Dimmed log lines carried data that party never saw in readable form."
    : !events.length ? `Run it, then see what ${name === "You" ? "you" : `the ${name.toLowerCase()}`} could read.`
    : lens === "relay" ? `The relay could read ${seen.length} of ${withData.length} data items: settings, nonces, the enclave's public key, ciphertext and signatures. Never your question or the answer.`
    : `${name === "You" ? "You" : `The ${name.toLowerCase()}`} could read ${seen.length} of ${withData.length} data items in this run.`;
}

// ---------- rail ----------
const rail = $("rail");
rail.innerHTML = STAGES.map((s, i) => `<button class="stage" type="button" data-s="${s.id}" title="${esc(s.what)}"><span class="sn mono">${String(i + 1).padStart(2, "0")}</span><span class="st">${s.title}</span><span class="sv mono">waiting</span></button>`).join("");
const stageEl = (id: StageId) => rail.querySelector<HTMLButtonElement>(`[data-s="${id}"]`)!;
rail.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".stage"); if (!b) return;
  const i = events.findIndex((x) => x.stage === b.dataset.s); if (i < 0) return;
  const li = log.querySelector<HTMLLIElement>(`li[data-i="${i}"]`); if (!li) return;
  log.scrollTo({ top: li.offsetTop - 8, behavior: reduced ? "auto" : "smooth" }); li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
});
const stageStart = new Map<StageId, number>();
function markStage(e: FlowEvent) {
  if (!stageStart.has(e.stage)) {
    // close the previous stage
    const prev = [...stageStart.keys()].pop();
    if (prev) finishStage(prev, e.t);
    stageStart.set(e.stage, e.t);
    const b = stageEl(e.stage); b.dataset.state = "active"; b.querySelector(".sv")!.textContent = "running";
    if (!reduced) b.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }
  const b = stageEl(e.stage);
  if (e.kind === "fail") b.dataset.bad = "fail"; else if (e.kind === "warn" && b.dataset.bad !== "fail") b.dataset.bad = "warn";
}
function finishStage(id: StageId, t: number) {
  const b = stageEl(id), dur = t - (stageStart.get(id) ?? t);
  b.dataset.state = b.dataset.bad ?? "ok";
  b.querySelector(".sv")!.textContent = `${b.dataset.bad === "fail" ? "failed" : b.dataset.bad === "warn" ? "note" : "done"} · ${(dur / 1000).toFixed(2)}s`;
}

// ---------- log ----------
const log = $("log");
let events: FlowEvent[] = [];
type Filter = "all" | "step" | "check" | "data" | "problem";
const FILTERS: { id: Filter; label: string; match: (k: Kind) => boolean }[] = [
  { id: "all", label: "All", match: () => true }, { id: "step", label: "Requests", match: (k) => k === "step" },
  { id: "check", label: "Checks", match: (k) => k === "ok" || k === "fail" || k === "warn" || k === "info" }, { id: "data", label: "Data", match: (k) => k === "data" },
  { id: "problem", label: "Problems", match: (k) => k === "fail" || k === "warn" },
];
let filter: Filter = "all";
const filtersEl = $("filters");
filtersEl.innerHTML = FILTERS.map((f) => `<button class="chip" type="button" aria-pressed="${f.id === filter}" data-f="${f.id}">${f.label}</button>`).join("");
filtersEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-f]"); if (!b) return;
  filter = b.dataset.f as Filter; filtersEl.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  const m = FILTERS.find((f) => f.id === filter)!.match;
  log.querySelectorAll<HTMLLIElement>("li[data-i]").forEach((li) => (li.hidden = !m(events[+li.dataset.i!].kind)));
});
const ICON: Record<Kind, string> = { step: "→", ok: "✓", fail: "✗", warn: "!", data: "◆", info: "·" };
let follow = true;
log.addEventListener("scroll", () => { follow = log.scrollTop + log.clientHeight >= log.scrollHeight - 40; }, { passive: true });

function addRow(e: FlowEvent, i: number) {
  $("log-empty").hidden = true;
  const li = document.createElement("li");
  li.dataset.i = String(i); li.className = `row ${e.kind}`;
  const hasMore = !!(e.detail || e.data);
  li.innerHTML = `<button type="button" class="row-btn" ${hasMore ? 'aria-expanded="false"' : "disabled"}>
    <span class="rt">+${(e.t / 1000).toFixed(2)}s</span><span class="ra a-${e.actor}">${NODES[e.actor].label}</span><span class="ri">${ICON[e.kind]}</span><span class="rx">${esc(e.text)}</span>${hasMore ? '<span class="rm" aria-hidden="true">+</span>' : ""}
  </button>${hasMore ? `<div class="row-more" hidden>${e.detail ? `<p>${esc(e.detail)}</p>` : ""}${e.data ? `<pre>${esc(e.data)}</pre><p class="vis">Readable by: ${(e.visibleTo ?? ["you"]).map((v) => NODES[v].label).join(", ")}</p>` : ""}</div>` : ""}`;
  const btn = li.querySelector<HTMLButtonElement>(".row-btn")!;
  if (hasMore) btn.addEventListener("click", () => { const o = btn.getAttribute("aria-expanded") === "true"; btn.setAttribute("aria-expanded", String(!o)); (li.querySelector(".row-more") as HTMLElement).hidden = o; li.classList.toggle("open", !o); });
  li.hidden = !FILTERS.find((f) => f.id === filter)!.match(e.kind);
  li.classList.toggle("hidden-from", !sees(e, lens));
  log.appendChild(li);
  if (follow) log.scrollTop = log.scrollHeight;
}

function handle(e: FlowEvent, animate = true) {
  const i = events.push(e) - 1;
  markStage(e);
  addRow(e, i);
  if (animate) { if (e.path) packet(e.path, e.kind); ping(e.actor, e.kind); }
  else if (e.kind !== "info") { const g = nodeEls.get(e.actor); if (g && e.kind === "fail") g.dataset.state = "fail"; else if (g && !g.dataset.state && e.kind === "ok") g.dataset.state = "ok"; else if (g && e.kind === "warn" && g.dataset.state !== "fail") g.dataset.state = "warn"; }
  if (!waiting) setStatus(e.text, e.kind);
  if (lens !== "all") applyLens();
}

// ---------- status + waiting timer ----------
const status = $("status");
let waiting: { label: string; t0: number } | null = null, waitTimer = 0;
function setStatus(text: string, kind: Kind | "busy" = "info") { status.innerHTML = `<span class="sd ${kind}"></span>${esc(text)}`; }
function onWait(label: string | null) {
  clearInterval(waitTimer);
  if (!label) { waiting = null; return; }
  waiting = { label, t0: performance.now() };
  const tick = () => { if (waiting) setStatus(`${waiting.label}… ${((performance.now() - waiting.t0) / 1000).toFixed(1)} s`, "busy"); };
  tick(); waitTimer = window.setInterval(tick, 100);
}

// ---------- runs ----------
let busy = false, paused = false, skipping = false;
const go = $<HTMLButtonElement>("go"), replayBtn = $<HTMLButtonElement>("replay"), pauseBtn = $<HTMLButtonElement>("pause"), skipBtn = $<HTMLButtonElement>("skip");
$<HTMLSelectElement>("speed").addEventListener("change", (e) => (speed = +(e.target as HTMLSelectElement).value));
function reset() {
  events = []; log.querySelectorAll("li").forEach((x) => x.remove()); $("log-empty").hidden = false; follow = true;
  stageStart.clear(); rail.querySelectorAll<HTMLButtonElement>(".stage").forEach((b) => { delete b.dataset.state; delete b.dataset.bad; b.querySelector(".sv")!.textContent = "waiting"; });
  nodeEls.forEach((g) => delete g.dataset.state);
  $("result").hidden = true; $<HTMLButtonElement>("dl-log").disabled = true; applyLens();
}
function lock(on: boolean, replaying = false) {
  busy = on; go.disabled = replayBtn.disabled = on; $<HTMLInputElement>("q").disabled = on;
  pauseBtn.disabled = skipBtn.disabled = !(on && replaying); paused = false; pauseBtn.textContent = "Pause"; pauseBtn.setAttribute("aria-pressed", "false");
}
pauseBtn.addEventListener("click", () => { paused = !paused; pauseBtn.textContent = paused ? "Resume" : "Pause"; pauseBtn.setAttribute("aria-pressed", String(paused)); });
skipBtn.addEventListener("click", () => { skipping = true; paused = false; });

interface Done { answer?: string; receipt?: any; note?: string; ok: boolean; requestBody?: string }
let lastReceipt: any = null;
function finish(d: Done) {
  const last = [...stageStart.keys()].pop(); if (last && events.length) finishStage(last, events[events.length - 1].t);
  $<HTMLButtonElement>("dl-log").disabled = !events.length;
  if (d.answer) {
    $("result").hidden = false; $("answer").textContent = d.answer;
    const checks = events.filter((e) => e.kind === "ok").length;
    $("proof-line").innerHTML = d.ok ? `<span class="ok">✓</span> ${checks} checks passed. The receipt proves this answer came from the attested enclave, under the rules registered on NEAR.${d.note ? ` <span class="muted">${esc(d.note)}</span>` : ""}` : `<span class="fail">✗</span> The run did not fully verify.`;
    $("relay-saw").textContent = d.requestBody ? prettyBody(d.requestBody) : "(not available)";
    lastReceipt = d.receipt ?? null; $<HTMLButtonElement>("dl-receipt").disabled = !lastReceipt;
  }
  setStatus(d.ok ? `Done in ${(events[events.length - 1].t / 1000).toFixed(1)} s. Every step in the log was checked ${d.note ? "during the recorded run" : "in your browser"}.` : "Stopped. See the last lines of the log.", d.ok ? "ok" : "fail");
}
const prettyBody = (b: string) => { try { const j = JSON.parse(b); j.messages = j.messages.map((m: any) => ({ role: m.role, content: `${String(m.content).slice(0, 96)}… (${String(m.content).length / 2} bytes of ciphertext)` })); return JSON.stringify(j, null, 2); } catch { return b.slice(0, 600); } };

$("controls").addEventListener("submit", async (ev) => {
  ev.preventDefault(); if (busy) return;
  const question = $<HTMLInputElement>("q").value.trim(); if (!question) return;
  reset(); lock(true); setStatus("Loading the verifier (Intel and NVIDIA checks run in your browser)…", "busy");
  try {
    const { runFlow } = await import("./flow");
    const res = await runFlow({ relay: RELAY, question, emit: (e) => handle(e), onWait });
    finish({ ok: res.ok, answer: res.answer, receipt: res.receipt, requestBody: res.receipt?.requestBody });
  } catch (e) { setStatus(`Could not run: ${e instanceof Error ? e.message : e}`, "fail"); }
  finally { onWait(null); lock(false); }
});

replayBtn.addEventListener("click", async () => {
  if (busy) return;
  reset(); lock(true, true); skipping = false; setStatus("Loading the recorded run…", "busy");
  try {
    const r = await (await fetch("./recorded-run.json")).json() as { recordedAt: string; question: string; answer: string; receipt: any; events: FlowEvent[] };
    $<HTMLInputElement>("q").value = r.question;
    let prev = 0;
    for (const e of r.events) {
      while (paused && !skipping) await sleep(120);
      if (!skipping) { const gap = Math.min(Math.max(e.t - prev, 70), 1500) / speed; await sleep(gap); }
      prev = e.t; handle(e, !skipping);
    }
    finish({ ok: true, answer: r.answer, receipt: r.receipt, requestBody: r.receipt?.requestBody, note: `Recorded ${new Date(r.recordedAt).toUTCString().replace(" GMT", " UTC")}. Its 800 KB attestation report is left out of the download; a live run gives the full receipt.` });
  } catch (e) { setStatus(`Could not load the recording: ${e instanceof Error ? e.message : e}`, "fail"); }
  finally { lock(false); skipping = false; }
});

const download = (name: string, data: unknown) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
$("dl-log").addEventListener("click", () => download(`veil-log-${Date.now()}.json`, events));
$("dl-receipt").addEventListener("click", () => lastReceipt && download(`veil-receipt-${String(lastReceipt.id).slice(0, 8)}.json`, lastReceipt));
applyLens();
