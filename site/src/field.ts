// The home hero's signature: a field of ciphertext that folds like fabric. Where the pointer passes, the veil lifts and the plaintext
// underneath shows through, which is the whole product in one gesture: the words are there, and only the right key reveals them.
// Without a pointer (touch screens, or after a few idle seconds) the opening drifts on its own. 30 fps, paused when off-screen.
import { reduced } from "./fx";

const HEX = "0123456789abcdef";
const PLAIN = "your words stay yours. only you and the enclave can read this. the relay carries noise. the network carries noise. ";

export function cipherField(canvas: HTMLCanvasElement, host: HTMLElement) {
  const ctx = canvas.getContext("2d", { alpha: true })!;
  let W = 0, H = 0, cols = 0, rows = 0, cw = 11, ch = 19, dpr = 1;
  let glyphs: string[] = [];
  const ptr = { x: -9999, y: -9999, tx: -9999, ty: -9999, last: 0, active: false };
  let visible = true, raf = 0, prev = 0;

  const resize = () => {
    const r = host.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    cw = W < 700 ? 9 : 11; ch = W < 700 ? 16 : 19;
    cols = Math.ceil(W / cw) + 1; rows = Math.ceil(H / ch) + 1;
    glyphs = Array.from({ length: cols * rows }, () => HEX[(Math.random() * 16) | 0]);
  };
  const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  const draw = (now: number) => {
    const t = now / 1000;
    // the opening eases toward the pointer, or wanders when nobody is pointing
    if (!ptr.active || now - ptr.last > 3500) { ptr.tx = W * (0.62 + 0.24 * Math.sin(t * 0.23)); ptr.ty = H * (0.42 + 0.22 * Math.sin(t * 0.31 + 1.3)); }
    ptr.x += (ptr.tx - ptr.x) * 0.12; ptr.y += (ptr.ty - ptr.y) * 0.12;
    for (let i = 0; i < glyphs.length * 0.02; i++) glyphs[(Math.random() * glyphs.length) | 0] = HEX[(Math.random() * 16) | 0];

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.font = `${cw < 10 ? 12 : 13.5}px "IBM Plex Mono", ui-monospace, monospace`; ctx.textBaseline = "top";
    const R = Math.min(190, Math.max(120, W * 0.12));
    // pass 1: the veil
    ctx.fillStyle = "hsl(252 92% 72%)";
    for (let y = 0; y < rows; y++) {
      const py = y * ch, fadeY = 0.35 + 0.65 * (1 - py / H);
      for (let x = 0; x < cols; x++) {
        const px = x * cw;
        const fold = 0.5 + 0.5 * Math.sin(px * 0.011 + t * 0.55 + 2.2 * Math.sin(py * 0.009 + t * 0.35));
        const d = Math.hypot(px - ptr.x, py - ptr.y), lift = d < R ? smooth(R, R * 0.35, d) : 0;
        const a = (0.05 + 0.3 * fold * fold) * fadeY * (1 - lift);
        if (a < 0.03) continue;
        ctx.globalAlpha = a; ctx.fillText(glyphs[y * cols + x], px, py);
      }
    }
    // pass 2: the plaintext under the opening
    ctx.fillStyle = "#fff";
    const x0 = Math.max(0, Math.floor((ptr.x - R) / cw)), x1 = Math.min(cols, Math.ceil((ptr.x + R) / cw));
    const y0 = Math.max(0, Math.floor((ptr.y - R) / ch)), y1 = Math.min(rows, Math.ceil((ptr.y + R) / ch));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x * cw - ptr.x, y * ch - ptr.y); if (d >= R) continue;
      const k = smooth(R, R * 0.35, d); if (k < 0.04) continue;
      ctx.globalAlpha = k * 0.92; ctx.fillText(PLAIN[(y * cols + x) % PLAIN.length], x * cw, y * ch);
    }
    ctx.globalAlpha = 1;
  };

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden || now - prev < 33) return;
    prev = now; draw(now);
  };

  host.addEventListener("pointermove", (e) => { const r = host.getBoundingClientRect(); ptr.tx = e.clientX - r.left; ptr.ty = e.clientY - r.top; ptr.active = true; ptr.last = performance.now(); }, { passive: true });
  host.addEventListener("pointerleave", () => { ptr.active = false; });
  new ResizeObserver(() => { resize(); if (reduced) draw(4000); }).observe(host);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(host);
  resize();
  ptr.x = ptr.tx = W * 0.66; ptr.y = ptr.ty = H * 0.45;
  const start = () => (reduced ? draw(4000) : (raf = requestAnimationFrame(loop)));
  (document.fonts?.ready ?? Promise.resolve()).then(start);
  return () => cancelAnimationFrame(raf);
}
