// Shared page chrome: the nav (desktop pill, mobile sheet), the footer, and copy buttons on code blocks.
import "./style.css";
import { reduced, setMotion } from "./fx";

export const RELAY = "https://veil-relay-oitl.onrender.com";
export const REPO = "https://github.com/nirmalplays/Veil";
export const CONTRACT = "veil-31da02.testnet";

/** The Veil mark: a V whose right stroke is cut into slats, like text behind a veil. */
export const mark = (size = 26) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
  <defs><mask id="vm${size}"><rect width="32" height="32" fill="#fff"/><path d="M16 9.5h14M16 15h14M16 20.5h14" stroke="#000" stroke-width="1.7"/></mask></defs>
  <path d="M2 4h7.2L16 22.6 22.8 4H30L19.6 29h-7.2z" fill="#fff" mask="url(#vm${size})"/></svg>`;

const PAGES = [{ href: "/", label: "Home", id: "home" }, { href: "/live", label: "Live", id: "live" }, { href: "/docs", label: "Docs", id: "docs" }];

export function chrome(active: "home" | "live" | "docs") {
  const links = PAGES.map((p) => `<a href="${p.href}"${p.id === active ? ' aria-current="page"' : ""}>${p.label}</a>`).join("") + `<a href="${REPO}" rel="noopener">GitHub</a>`;
  document.body.insertAdjacentHTML("afterbegin", `
<a class="skip" href="#main">Skip to content</a>
<header class="nav"><div class="nav-in">
  <a class="brand" href="/" aria-label="Veil home">${mark()}<span>VEIL</span></a>
  <nav class="nav-links" aria-label="Primary">${links}</nav>
  <div class="nav-cta">
    <a class="star" href="/live" data-magnet><span>Watch a message go through</span></a>
    <button class="menu-btn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="sheet"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M4 9h16M4 15h10"/></svg></button>
  </div>
</div></header>
<div class="sheet" id="sheet" aria-hidden="true"><div></div><div></div><div role="dialog" aria-modal="true" aria-label="Menu">
  <div class="top"><span class="brand">${mark()}<span>VEIL</span></span><button class="x-btn" type="button" aria-label="Close menu"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
  <nav aria-label="Menu">${links}</nav>
</div></div>`);
  const sheet = document.getElementById("sheet")!, open = document.querySelector<HTMLButtonElement>(".menu-btn")!;
  const set = (on: boolean) => { sheet.classList.toggle("open", on); sheet.setAttribute("aria-hidden", String(!on)); open.setAttribute("aria-expanded", String(on)); document.body.style.overflow = on ? "hidden" : ""; if (on) sheet.querySelector<HTMLElement>(".x-btn")?.focus(); else open.focus(); };
  // the header condenses into a glass pill once the page has scrolled
  const navEl = document.querySelector<HTMLElement>(".nav")!;
  const onScroll = () => navEl.classList.toggle("scrolled", scrollY > 40);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
  open.onclick = () => set(true);
  sheet.querySelector<HTMLButtonElement>(".x-btn")!.onclick = () => set(false);
  sheet.querySelectorAll("nav a").forEach((a) => a.addEventListener("click", () => set(false)));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet.classList.contains("open")) set(false); });

  document.body.insertAdjacentHTML("beforeend", `
<footer class="foot"><div class="wrap">
  <div class="foot-grid">
    <p class="h2" style="max-width:640px">AI you can <span class="veiled">check,</span> not just trust.</p>
    <div style="display:flex;flex-wrap:wrap;gap:48px 72px">
      <nav class="foot-col" aria-label="Footer"><span class="eyebrow">Navigate</span>${PAGES.map((p) => `<a href="${p.href}">${p.label}</a>`).join("")}</nav>
      <div class="foot-col"><span class="eyebrow">Build</span><a href="${REPO}" rel="noopener">Source on GitHub</a><a href="/docs#embed">Embed the widget</a><a href="/docs#relay">Host a relay</a></div>
      <div class="foot-col"><span class="eyebrow">On chain</span><a href="https://testnet.nearblocks.io/address/${CONTRACT}" rel="noopener">${CONTRACT}</a><a href="${RELAY}/config" rel="noopener">Live relay</a></div>
    </div>
  </div>
  <div class="wordmark" aria-hidden="true">VEIL</div>
  <div class="legal"><span>MIT licensed · NEAR testnet · not legal advice · <button class="motion-btn" type="button" id="motion-btn" aria-pressed="${reduced}">${reduced ? "Turn motion back on" : "Reduce motion"}</button></span><span>Messages are encrypted in your browser. This site keeps nothing.</span></div>
</div></footer>`);
  document.getElementById("motion-btn")!.addEventListener("click", () => setMotion(!reduced));
  addCopyButtons();
}

export function addCopyButtons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(".code").forEach((c) => {
    const b = c.querySelector<HTMLButtonElement>(".copy"); if (!b || b.dataset.wired) return; b.dataset.wired = "1";
    b.addEventListener("click", async () => {
      const text = c.querySelector("pre")?.textContent ?? "";
      try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch { b.textContent = "Select and copy"; }
      setTimeout(() => (b.textContent = "Copy"), 1600);
    });
  });
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const codeBlock = (label: string, code: string, html = false) => `<div class="code"><div class="bar"><span>${label}</span><button class="copy" type="button">Copy</button></div><pre><code>${html ? code : esc(code)}</code></pre></div>`;
