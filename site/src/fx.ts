// Scroll and pointer effects, in the reference site's vocabulary.
// Motion is on by default, like the reference site: Windows reports "reduce motion" whenever its animation effects are off (common on
// servers and remote desktops), which would leave the page static for people who never asked for that. The footer's "Reduce motion"
// switch turns everything off and is remembered in this browser.
const MOTION_KEY = "veil-motion";
const stored = (() => { try { return localStorage.getItem(MOTION_KEY); } catch { return null; } })();
export const reduced = stored === "reduce";
document.documentElement.dataset.motion = reduced ? "reduce" : "full";
export function setMotion(reduce: boolean) {
  try { localStorage.setItem(MOTION_KEY, reduce ? "reduce" : "full"); } catch { /* storage blocked: applies to this page only */ }
  document.documentElement.dataset.motion = reduce ? "reduce" : "full";
  location.reload();
}
const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
const q = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => Array.from(r.querySelectorAll<T & HTMLElement>(s));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const GLYPHS = "0123456789abcdef";

/** Replaces text with random hex that settles, left to right, into the real text. */
export function decrypt(el: HTMLElement, text = el.dataset.text ?? el.textContent ?? "", speed = 32): Promise<void> {
  el.dataset.text = text;
  if (reduced) { el.textContent = text; return Promise.resolve(); }
  return new Promise((done) => {
    let n = 0;
    const t = setInterval(() => {
      n += Math.max(1, Math.ceil(text.length / 40));
      el.textContent = text.split("").map((c, i) => (i < n || c === " " ? c : GLYPHS[(Math.random() * 16) | 0])).join("");
      if (n >= text.length) { clearInterval(t); el.textContent = text; done(); }
    }, speed);
  });
}

export function initFx() {
  const fx: (() => void)[] = [];
  let ticking = false;
  const run = () => { ticking = false; fx.forEach((f) => f()); };
  const req = () => { if (!ticking) { ticking = true; requestAnimationFrame(run); } };
  addEventListener("scroll", req, { passive: true }); addEventListener("resize", req);

  // headline lines rise out of a mask
  q("[data-split]").forEach((h) => {
    if (h.dataset.splitDone) return; h.dataset.splitDone = "1";
    const lines = (h.innerHTML.split("<br>"));
    h.innerHTML = lines.map((l) => `<span class="ln"><span>${l}</span></span>`).join("");
  });

  // veiled words: ciphertext until read
  const veiled = q(".veiled");
  const scramble = (t: string) => t.split("").map((c) => (c === " " ? " " : GLYPHS[(Math.random() * 16) | 0])).join("");
  const reveal = (v: HTMLElement) => { v.classList.add("cipher"); return decrypt(v, v.dataset.text, 38).then(() => v.classList.remove("cipher")); };
  veiled.forEach((v) => { v.dataset.text = v.textContent ?? ""; v.setAttribute("aria-label", v.dataset.text); });
  if (false as boolean) {   // accent words are a serif accent now, not scrambled
    veiled.forEach((v) => { v.textContent = scramble(v.dataset.text!); v.classList.add("cipher"); });
    const iov = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { iov.unobserve(en.target); setTimeout(() => reveal(en.target as HTMLElement), 350); } }), { rootMargin: "0px 0px -15% 0px" });
    veiled.forEach((v) => iov.observe(v));
    if (fine) veiled.forEach((v) => { let busy = false; v.addEventListener("mouseenter", () => { if (busy || v.classList.contains("cipher")) return; busy = true; v.textContent = scramble(v.dataset.text!); reveal(v).then(() => (busy = false)); }); });
  }

  if (!reduced && "IntersectionObserver" in window) {
    const below = (e: Element) => e.getBoundingClientRect().top > innerHeight * 0.92;
    const ins = q("[data-in]").filter(below), splits = q("[data-split]");
    ins.forEach((e) => { e.style.opacity = "0"; e.style.transform = "translateY(24px)"; });
    splits.forEach((h) => q(".ln > span", h).forEach((l) => { l.style.transform = "translateY(105%)"; }));
    const io = new IntersectionObserver((es) => es.forEach((en) => {
      if (!en.isIntersecting) return; const t = en.target as HTMLElement; io.unobserve(t);
      if (t.hasAttribute("data-split")) q(".ln > span", t).forEach((l, i) => { l.style.transition = `transform 1s var(--ease) ${0.08 + i * 0.09}s`; l.style.transform = "none"; });
      else { const d = parseFloat(t.dataset.in || "0") || 0; t.style.transition = `opacity .7s ease-out ${d}s, transform .9s var(--ease) ${d}s`; t.style.opacity = "1"; t.style.transform = "none"; }
    }), { rootMargin: "0px 0px -60px 0px" });
    ins.forEach((e) => io.observe(e)); splits.forEach((e) => io.observe(e));

    const io2 = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { io2.unobserve(en.target); decrypt(en.target as HTMLElement); } }));
    q("[data-decrypt]").forEach((e) => io2.observe(e));
  }

  // words sharpen from blur as the paragraph scrolls through
  q("[data-words]").forEach((p) => {
    if (!p.dataset.wDone) {
      // wrap words in text nodes only, so inline markup such as <em> survives
      p.dataset.wDone = "1";
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest(".veiled") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) }), texts: Text[] = [];
      while (walker.nextNode()) texts.push(walker.currentNode as Text);
      for (const t of texts) {
        const frag = document.createDocumentFragment();
        for (const part of (t.textContent ?? "").split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(part); continue; }
          const s = document.createElement("span"); s.dataset.w = ""; s.textContent = part; frag.append(s);
        }
        t.replaceWith(frag);
      }
    }
    const ws = q("[data-w]", p);
    const set = (n: number) => ws.forEach((w, i) => { const k = clamp(n - i, 0, 1); w.style.opacity = String(0.14 + 0.86 * k); w.style.filter = `blur(${(1 - k) * 5}px)`; });
    if (reduced) { set(ws.length); return; }
    fx.push(() => { const r = p.getBoundingClientRect(), vh = innerHeight; set(clamp((vh * 0.85 - r.top) / (r.height + vh * 0.25), 0, 1) * ws.length); });
  });

  if (fine && !reduced) {
    const ms = q("[data-magnet]");
    if (ms.length) addEventListener("mousemove", (e) => ms.forEach((el) => {
      const r = el.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (Math.abs(dx) < r.width / 2 + 120 && Math.abs(dy) < r.height / 2 + 120) { el.style.transition = "transform .3s ease-out"; el.style.transform = `translate3d(${dx / 7}px,${dy / 7}px,0)`; }
      else { el.style.transition = "transform .6s ease-in-out"; el.style.transform = ""; }
    }), { passive: true });
    q("[data-tilt]").forEach((el) => {
      const k = parseFloat(el.dataset.tilt || "5") || 5;
      el.addEventListener("mousemove", (e) => { const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; el.style.transform = `perspective(1200px) rotateX(${-y * k}deg) rotateY(${x * k}deg)`; });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });
  }
  if (fine) document.addEventListener("mousemove", (e) => {
    const c = (e.target as Element | null)?.closest?.(".spot") as HTMLElement | null; if (!c) return;
    const r = c.getBoundingClientRect(); c.style.setProperty("--mx", `${e.clientX - r.left}px`); c.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, { passive: true });

  run(); document.fonts?.ready.then(req);
  return { add: (f: () => void) => { fx.push(f); req(); } };
}
