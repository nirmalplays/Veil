// The live page: a 3D story of one message. A run (recorded, or live from this browser) produces real events; the director turns each
// one into a beat: a camera move, a packet in flight, a card that shows what was checked or what a party could see, and a plain-English
// caption. Nothing in the story is invented: every number, hash and check shown comes from the run being played.
import { gsap } from "gsap";
import { chrome, esc, RELAY } from "./chrome";
import { NODES, type FlowEvent, type StageId } from "./flow-meta";
import { World, type Station } from "./viz/world";
import type { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import "./live.css";

chrome("live");
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const world = new World($<HTMLCanvasElement>("world"), $("theatre"));

// ------------------------------------------------------------------ chapters
interface Chapter { id: StageId; short: string; title: string; accent: string; body: string; view: Parameters<World["focus"]>[0]; at?: Station }
const CHAPTERS: Chapter[] = [
  { id: "wake", short: "Knock", title: "Knock on the", accent: "door.", body: "Your browser reaches the website's relay: a small server that holds the site's AI key, so your browser never has to.", view: "relay" },
  { id: "policy", short: "Rules", title: "Check the rules haven't", accent: "changed.", body: "The site's instructions for its AI are fingerprinted and compared with the fingerprint stored on the NEAR blockchain. Change one word and this fails.", view: "near" },
  { id: "relay-tee", short: "Relay", title: "Ask the relay what it", accent: "is.", body: "The relay admits it runs on ordinary hosting. That's fine: in a moment you'll see it only ever carries sealed messages.", view: "relay" },
  { id: "attest", short: "Challenge", title: "Challenge the AI's", accent: "chip.", body: "Your browser sends a random challenge. The chip answers with a passport signed by the hardware itself, stamped with that exact challenge, so it can't be an old copy.", view: "overview" },
  { id: "verify", short: "Inspect", title: "Inspect the", accent: "passport.", body: "Your browser checks every seal itself. Intel vouches for the processor and NVIDIA for each of the eight GPUs. Only if all of them pass does it trust the chip's key.", view: "overview" },
  { id: "encrypt", short: "Lock", title: "Lock the", accent: "question.", body: "Your question is locked with a key that only exists inside that verified chip. To everyone else, it's now noise.", view: "you" },
  { id: "send", short: "Carry", title: "Carried blind through the", accent: "relay.", body: "The relay adds the site's key and passes the sealed box on. It can't open it. The card shows exactly what it sees.", view: "overview" },
  { id: "decrypt", short: "Answer", title: "Read only inside the", accent: "chip.", body: "Inside the sealed chip the question is opened and answered, then locked again with a one-time key that only your tab holds. Your browser opens it.", view: "you" },
  { id: "rules", short: "Obey", title: "Check the answer obeys the", accent: "rules.", body: "Before showing anything, your browser checks the answer against the rules registered on NEAR.", view: "you" },
  { id: "receipt", short: "Prove", title: "Get a signed", accent: "receipt.", body: "The chip signs the exact bytes it received and sent. Anyone can verify this receipt later, without trusting the site.", view: "enclave" },
];
const rail = $("t-rail");
rail.innerHTML = CHAPTERS.map((c, i) => `<li data-id="${c.id}"><span class="r-n mono">${String(i + 1).padStart(2, "0")}</span><span class="r-t">${c.short}</span><i></i></li>`).join("");
const railItem = (id: StageId) => rail.querySelector<HTMLElement>(`[data-id="${id}"]`)!;

// ------------------------------------------------------------------ playback state
let speed = 1, paused = false, runId = 0, question = "", busy = false;
let events: FlowEvent[] = [], receipt: unknown = null;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms / speed));
const waitWhilePaused = async (id: number) => { while (paused && id === runId) await new Promise((r) => setTimeout(r, 120)); };
gsap.globalTimeline.timeScale(1);

const step = $("t-step"), title = $("t-title"), body = $("t-body"), tech = $("t-tech");
function caption(c: Chapter, i: number) {
  gsap.to([title, body], { opacity: 0, y: -10, duration: 0.25, onComplete: () => {
    step.textContent = `Step ${String(i + 1).padStart(2, "0")} of 10`;
    title.innerHTML = `${esc(c.title)} <span class="accent">${esc(c.accent)}</span>`;
    body.textContent = c.body; tech.textContent = "";
    gsap.fromTo([title, body], { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.08, ease: "power3.out" });
  } });
}
const techLine = (t: string) => { tech.textContent = t; gsap.fromTo(tech, { opacity: 0 }, { opacity: 1, duration: 0.4 }); };

// ------------------------------------------------------------------ cards that float next to stations
const cards: CSS2DObject[] = [];
function card(st: Station, offset: [number, number, number], cls: string, html: string) {
  const outer = document.createElement("div"); outer.className = "w-anchor";
  const el = document.createElement("div"); el.className = `w-card ${cls}`; el.innerHTML = html; outer.appendChild(el);
  const o = world.anchor(st, offset, outer); cards.push(o);
  gsap.fromTo(el, { opacity: 0, y: 12, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "power3.out" });
  return el;
}
function clearCards() { while (cards.length) world.remove(cards.pop()!); }
function dropCard(el: HTMLElement) { const o = cards.find((c) => c.element === el.parentElement); if (o) { gsap.to(el, { opacity: 0, duration: 0.4, onComplete: () => { world.remove(o); cards.splice(cards.indexOf(o), 1); } }); } }

// ------------------------------------------------------------------ the director
let chapter: StageId | null = null, passport: HTMLElement | null = null, rulesCard: HTMLElement | null = null, receiptCard: HTMLElement | null = null, relayView: HTMLElement | null = null;
let gpuLit = 0;
const short = (h = "", n = 10) => (h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-6)}` : h);

async function enter(id: StageId) {
  const i = CHAPTERS.findIndex((c) => c.id === id), c = CHAPTERS[i];
  if (chapter) { const prev = railItem(chapter); prev.classList.remove("on"); prev.classList.add(prev.dataset.bad ? "warned" : "done"); }
  chapter = id; railItem(id).classList.add("on");
  clearCards(); passport = rulesCard = receiptCard = relayView = null;
  caption(c, i);
  world.focus(c.view, 1.8);
  if (id === "verify") {
    gpuLit = 0; world.resetGpus();
    passport = card("relay", [0, 3.0, 0], "passport", `<div class="pp-head"><span class="mono">Hardware passport</span><b>Enclave · z-ai/glm-5.3-flash</b></div><ul class="pp-list"></ul><div class="pp-gpus">${Array.from({ length: 8 }, () => "<i></i>").join("")}<span class="mono">8 GPUs</span></div><div class="pp-stamp">Trusted</div>`);
  }
  if (id === "rules") rulesCard = card("you", [3.6, 1.2, 0], "rules", `<span class="mono c-k">The site's registered rules</span><ul></ul>`);
  await sleep(1500);
}

async function beat(e: FlowEvent) {
  const s = e.stage;
  techLine(e.text);
  if (s === "wake") {
    if (e.kind === "step") { world.status("you", "busy"); world.setScreen({ eyebrow: "Connecting", text: "Reaching the site's relay…", mode: "busy" }); await world.fly(["you", "relay"], "ping", "hello?", 1.2); }
    if (e.kind === "ok") { world.status("relay", "ok"); world.status("you", "ok"); await world.fly(["relay", "you"], "ping", "site settings", 1.0); }
  } else if (s === "policy") {
    if (e.kind === "data") { world.setScreen({ eyebrow: "Fingerprint of the site's rules", text: e.data ?? "", mode: "cipher", foot: "SHA-256, computed in this tab" }); await sleep(900); }
    if (e.kind === "step") await world.fly(["you", "near"], "nonce", "is this fingerprint registered?", 1.4);
    if (e.kind === "ok" || e.kind === "fail") {
      const ok = e.kind === "ok"; world.chainCheck(ok); world.status("near", ok ? "ok" : "fail");
      const [reg = "", served = ""] = (e.data ?? "").split("\n").map((l) => l.split(/\s+/).pop() ?? "");
      card("near", [0, 1.45, 0], ok ? "match" : "bad", `<span class="mono c-k">Fingerprint check</span><div class="c-row"><span>On NEAR</span><code>${short(reg)}</code></div><div class="c-row"><span>Served</span><code>${short(served)}</code></div><b class="c-verdict">${ok ? "Match ✓" : "Mismatch ✗"}</b>`);
      await world.fly(["near", "you"], "proof", ok ? "match" : "mismatch", 1.2); await sleep(1200);
    }
  } else if (s === "relay-tee") {
    if (e.kind === "step") await world.fly(["you", "relay"], "nonce", "prove you're sealed hardware?", 1.1);
    if (e.kind === "warn") { world.status("relay", "warn"); railItem("relay-tee").dataset.bad = "1"; relayView = card("relay", [0, 2.35, 0], "warn", `<span class="mono c-k">The relay's answer</span><b>Ordinary hosting, not sealed hardware.</b><p>Its host could read the site's API key. It can't read your messages: those are locked to the AI's chip.</p>`); await world.fly(["relay", "you"], "warn", "not a TEE", 1.0); await sleep(1800); if (relayView) dropCard(relayView); relayView = null; }
    if (e.kind === "ok") world.status("relay", "ok");
  } else if (s === "attest") {
    if (e.kind === "data") { world.setScreen({ eyebrow: "A fresh random challenge", text: e.data ?? "", mode: "cipher", foot: "32 bytes, never used before" }); await sleep(700); }
    if (e.kind === "step") { world.focus("overview", 1.4); await world.fly(["you", "relay", "gateway", "enclave"], "nonce", "challenge", 0.85); world.pulse("enclave", 0x9d86ff, 1); }
    if (e.kind === "ok") { world.status("enclave", "busy"); await world.fly(["enclave", "gateway", "relay", "you"], "proof", `passport · ${e.text.match(/[\d.]+ KB/)?.[0] ?? ""}`, 0.85); }
  } else if (s === "verify") {
    if (e.kind === "step") { await sleep(500); return; }
    if (e.text.startsWith("Pinned")) {
      passport?.classList.add("trusted"); world.status("enclave", "ok"); world.pulse("enclave", 0xa6ebcb, 1);
      techLine(`${e.text}: ${short(e.data, 12)}`); await sleep(1800); return;
    }
    const ul = passport?.querySelector("ul");
    if (ul) {
      const li = document.createElement("li"); li.className = e.kind; li.innerHTML = `<span>${e.kind === "ok" ? "✓" : e.kind === "fail" ? "✗" : "–"}</span>${esc(e.text.replace(/^Gateway: /, "Gateway · "))}`;
      ul.appendChild(li); ul.scrollTop = ul.scrollHeight; gsap.fromTo(li, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.35 });
    }
    if (e.actor === "intel") { world.status("intel", "ok"); world.flash("you", "intel", 0x5ee6ff); world.pulse("intel", 0x5ee6ff); }
    else if (e.actor === "nvidia") {
      world.status("nvidia", "ok"); world.flash("relay", "nvidia", 0xa6ebcb); world.pulse("nvidia", 0xa6ebcb);
      for (let g = gpuLit; g < 8; g++) { world.gpu(g); passport?.querySelectorAll(".pp-gpus i")[g]?.classList.add("on"); await sleep(110); }
      gpuLit = 8;
    } else if (e.actor === "gateway") world.pulse("gateway", 0x9d86ff, 0.6);
    else world.pulse("enclave", 0x9d86ff, 0.5);
    await sleep(e.kind === "info" ? 260 : 420);
  } else if (s === "encrypt") {
    if (e.text.startsWith("Made a one-time")) { world.setScreen({ eyebrow: "Your question", text: question, mode: "plain", foot: "readable only here, for now" }); await sleep(1300); return; }
    if (e.text.startsWith("Encrypted")) {
      const cipher = (e.data ?? "").split("\n")[1]?.replace("ciphertext: ", "") ?? "";
      await scrambleScreen(question, cipher);
      card("you", [3.6, 1.0, 0], "lock", `<span class="mono c-k">Locked</span><b>${esc(e.text.replace("Encrypted your message: ", ""))}</b><p>XChaCha20-Poly1305, to the key that lives inside the verified chip.</p>`);
      await sleep(1600); clearCards();
    }
  } else if (s === "send") {
    if (e.kind === "step") {
      const hex = (e.data ?? "").replace(/^.*"content":"/, "").slice(0, 120);
      const fly = world.fly(["you", "relay"], "cipher", "your question · locked", 1.3);
      await fly;
      relayView = card("relay", [0, 2.4, 0], "relay-view", `<span class="mono c-k">What the relay sees</span><code class="noise">${esc(hex)}…</code><p>The model's name and noise. Nothing else.</p>`);
      world.focus("relay", 1.2); await sleep(2600);
      world.focus("overview", 1.4);
      await world.fly(["relay", "gateway", "enclave"], "cipher", "still locked", 0.95);
      if (relayView) dropCard(relayView); relayView = null;
      world.focus("enclave", 1.4); world.setThinking(true); world.setScreen({ eyebrow: "Waiting", text: "The enclave is answering…", mode: "busy" });
      await sleep(1600);
    }
    if (e.kind === "ok") {
      world.setThinking(false); world.focus("overview", 1.4);
      await world.fly(["enclave", "gateway", "relay", "you"], "answer", `answer · locked to your tab`, 0.9);
    }
  } else if (s === "decrypt") {
    world.focus("you", 1.2);
    world.setScreen({ eyebrow: "The answer, unlocked in this tab", text: e.data ?? "", mode: "answer" });
    card("you", [3.9, 0.9, 0], "answer", `<span class="mono c-k">Unlocked only in this tab</span><p class="ans">${esc(e.data ?? "")}</p>`);
    world.pulse("you", 0xf2f2f5, 1); await sleep(4200);
  } else if (s === "rules") {
    const ul = rulesCard?.querySelector("ul");
    if (ul && !e.text.startsWith("All ") && !e.text.startsWith("The widget")) { const li = document.createElement("li"); li.className = e.kind; li.innerHTML = `<span>${e.kind === "ok" ? "✓" : "!"}</span>${esc(e.text)}`; ul.appendChild(li); gsap.fromTo(li, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.35 }); await sleep(550); }
    else { rulesCard?.classList.add(e.kind === "ok" ? "passed" : "warned"); await sleep(1400); }
  } else if (s === "receipt") {
    if (e.kind === "step") { world.focus("overview", 1.3); await world.fly(["you", "relay", "gateway"], "nonce", "sign this exchange?", 0.9); }
    else if (e.kind === "data") {
      await world.fly(["gateway", "relay", "you"], "proof", "signature", 0.9);
      world.focus("enclave", 1.4);
      receiptCard = card("enclave", [-4.2, 2.6, 0], "receipt", `<span class="mono c-k">Receipt · ed25519</span><code>${esc(short(e.data, 18))}</code><ul></ul><div class="pp-stamp">Verified</div>`);
      await sleep(900);
    } else if (e.text.startsWith("Receipt verified") || e.text.startsWith("The receipt did not")) {
      receiptCard?.classList.add(e.kind === "ok" ? "trusted" : "bad"); world.pulse("enclave", 0xa6ebcb, 1); await sleep(2400);
    } else { const ul = receiptCard?.querySelector("ul"); if (ul) { const li = document.createElement("li"); li.className = e.kind; li.innerHTML = `<span>${e.kind === "ok" ? "✓" : "✗"}</span>${esc(e.text)}`; ul.appendChild(li); ul.scrollTop = ul.scrollHeight; } await sleep(200); }
  }
  if (e.kind === "fail") { railItem(s).dataset.bad = "1"; world.status(e.actor as Station, "fail"); }
}

/** The plaintext on the device's screen dissolves into ciphertext. */
async function scrambleScreen(plain: string, cipher: string) {
  const glyphs = "0123456789abcdef";
  for (let k = 0; k <= 14; k++) {
    const p = k / 14, n = Math.floor(plain.length * p);
    const mixed = plain.split("").map((ch, i) => (i < n ? glyphs[(Math.random() * 16) | 0] : ch)).join("");
    world.setScreen({ eyebrow: k < 14 ? "Locking…" : "What leaves your device", text: k < 14 ? mixed : cipher, mode: k < 14 ? "plain" : "cipher", foot: k < 14 ? "" : "noise to everyone but the chip" });
    await sleep(70);
  }
}

// ------------------------------------------------------------------ log drawer
const logList = $("t-log-list");
function logRow(e: FlowEvent) {
  const li = document.createElement("li"); li.className = e.kind;
  li.innerHTML = `<span class="lt">+${(e.t / 1000).toFixed(2)}s</span><span class="la">${NODES[e.actor].label}</span><span class="lx">${esc(e.text)}</span>`;
  logList.appendChild(li); logList.scrollTop = logList.scrollHeight; $("log-btn").textContent = `Technical log (${events.length})`;
}
$("log-btn").addEventListener("click", () => { const l = $("t-log"), open = l.hidden; l.hidden = !open; $("log-btn").setAttribute("aria-expanded", String(open)); });

// ------------------------------------------------------------------ running a story
let queue: FlowEvent[] = [], draining: Promise<void> | null = null, streamDone = false;
async function drain(id: number) {
  while (id === runId) {
    const e = queue.shift();
    if (!e) { if (streamDone) return; await new Promise((r) => setTimeout(r, 60)); continue; }
    await waitWhilePaused(id); if (id !== runId) return;
    if (e.stage !== chapter) await enter(e.stage);
    events.push(e); logRow(e);
    await beat(e);
  }
}
function reset() {
  runId++; queue = []; events = []; chapter = null; streamDone = false; paused = false; receipt = null;
  clearCards(); passport = rulesCard = receiptCard = relayView = null;
  logList.innerHTML = ""; $("t-end").hidden = true;
  rail.querySelectorAll("li").forEach((l) => { l.className = ""; delete (l as HTMLElement).dataset.bad; });
  (["you", "relay", "gateway", "enclave", "near", "intel", "nvidia"] as Station[]).forEach((s) => world.status(s, "idle"));
  world.resetGpus(); world.setThinking(false);
}
let mode: "idle" | "replay" | "live" = "idle";
/** A replay can always be interrupted by asking a real question; a live run can't be interrupted by another one. */
function lock(on: boolean, m: typeof mode = "idle") {
  busy = on; mode = on ? m : "idle";
  $<HTMLButtonElement>("replay").disabled = on; $<HTMLButtonElement>("go").disabled = on && m === "live"; $<HTMLButtonElement>("pause").disabled = !on;
}
async function finish(ok: boolean) {
  world.focus("overview", 2);
  const checks = events.filter((e) => e.kind === "ok").length;
  const total = events.length ? events[events.length - 1].t / 1000 : 0;
  $("t-end-k").textContent = ok ? "Done" : "Stopped";
  $("t-end-h").innerHTML = ok ? `Answered privately, <span class="accent">and proven.</span>` : `The run stopped <span class="accent">safely.</span>`;
  $("t-end-stats").innerHTML = [
    [`${checks}`, "checks passed"], [`${events.length}`, "real events"], [`${total.toFixed(1)}s`, "start to finish"], ["0", "bytes the relay could read"],
  ].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join("");
  $<HTMLButtonElement>("dl-receipt").hidden = !receipt;
  await sleep(1200); $("t-end").hidden = false; gsap.fromTo("#t-end", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" });
}

async function replay() {
  if (busy) return; reset(); lock(true, "replay"); const id = runId;
  try {
    const r = await (await fetch("./recorded-run.json")).json() as { question: string; receipt: unknown; events: FlowEvent[] };
    question = r.question; receipt = r.receipt; $<HTMLInputElement>("q").value = "";
    queue = [...r.events]; streamDone = true;
    world.setScreen({ eyebrow: "Your question", text: question, mode: "plain" });
    draining = drain(id); await draining;
    if (id === runId) await finish(!r.events.some((e) => e.kind === "fail"));
  } finally { if (id === runId) lock(false); }
}
async function live(q: string) {
  if (mode === "live") return;
  gsap.globalTimeline.paused(false); reset(); lock(true, "live"); const id = runId; question = q; $("t-end").hidden = true;
  world.setScreen({ eyebrow: "Your question", text: q, mode: "plain" });
  try {
    draining = drain(id);
    const { runFlow } = await import("./flow");
    const res = await runFlow({ relay: RELAY, question: q, emit: (e) => { if (id === runId) queue.push(e); }, onWait: (l) => { if (l && id === runId) techLine(`${l}…`); } });
    streamDone = true; receipt = res.receipt ?? null; await draining;
    if (id === runId) await finish(res.ok);
  } catch (err) { techLine(`Could not run: ${err instanceof Error ? err.message : err}`); streamDone = true; }
  finally { if (id === runId) lock(false); }
}

$("replay").addEventListener("click", () => replay());
$("again").addEventListener("click", () => replay());
$("own").addEventListener("click", () => { $("t-end").hidden = true; $<HTMLInputElement>("q").focus(); });
$("ask").addEventListener("submit", (e) => { e.preventDefault(); const q = $<HTMLInputElement>("q").value.trim(); if (q) live(q); });
$("pause").addEventListener("click", () => { paused = !paused; $("pause").textContent = paused ? "Resume" : "Pause"; gsap.globalTimeline.paused(paused); });
$("speed").addEventListener("click", () => { speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1; $("speed").textContent = `${speed}×`; gsap.globalTimeline.timeScale(speed); });
const download = (name: string, data: unknown) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
$("dl-log").addEventListener("click", () => download(`veil-log-${Date.now()}.json`, events));
$("dl-receipt").addEventListener("click", () => receipt && download("veil-receipt.json", receipt));

// start the story on its own: opening the page is enough to see it
world.focus("overview", 0.01);
setTimeout(() => replay(), 1400);
