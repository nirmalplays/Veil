// Real screen recordings of the product. They play muted while in view and pause when not; clicking one opens it full size with controls.
// With reduced motion on, nothing autoplays: a play button starts them on request.
import { reduced } from "./fx";

export interface Clip { id: "run" | "chat" | "type"; title: string; meta: string }
export const CLIPS: Record<Clip["id"], Clip> = {
  run: { id: "run", title: "A real message through the pipeline", meta: "Live view · 16 s · real time" },
  chat: { id: "chat", title: "A real conversation with the widget", meta: "Home page · 21 s · real time" },
  type: { id: "type", title: "Encrypted as you type", meta: "Hero · 11 s · real time" },
};
const sources = (id: string) => `<source src="./media/${id}.webm" type="video/webm"><source src="./media/${id}.mp4" type="video/mp4">`;

export const clipHtml = (id: Clip["id"], extra = "") => {
  const c = CLIPS[id];
  return `<figure class="clip ${extra}" data-clip="${id}">
    <button class="clip-open" type="button" aria-label="Play “${c.title}” full size">
      <video muted loop playsinline preload="none" poster="./media/${id}.jpg">${sources(id)}</video>
      <span class="clip-rec mono" aria-hidden="true"><i></i>REC</span>
      <span class="clip-play" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg></span>
    </button>
    <figcaption><span class="clip-t">${c.title}</span><span class="clip-m mono">${c.meta}</span></figcaption>
  </figure>`;
};

export function initClips(root: ParentNode = document) {
  const vids = [...root.querySelectorAll<HTMLVideoElement>(".clip video, video[data-bg]")];
  if (!reduced && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      const v = e.target as HTMLVideoElement;
      if (e.isIntersecting) { v.preload = "auto"; v.play().catch(() => {}); } else v.pause();
    }), { threshold: 0.35 });
    vids.forEach((v) => io.observe(v));
  }
  let dlg = document.getElementById("clip-dlg") as HTMLDialogElement | null;
  if (!dlg) {
    document.body.insertAdjacentHTML("beforeend", `<dialog class="clip-dlg" id="clip-dlg" aria-label="Video">
      <div class="clip-dlg-in"><div class="clip-dlg-head"><span class="eyebrow" id="clip-dlg-t"></span><button class="x-btn" type="button" aria-label="Close video"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <video controls playsinline id="clip-dlg-v"></video><p class="mono clip-dlg-note">Recorded against the live relay and the real NEAR AI enclave. Nothing in it is mocked.</p></div></dialog>`);
    dlg = document.getElementById("clip-dlg") as HTMLDialogElement;
    const v = dlg.querySelector("video")!;
    dlg.querySelector(".x-btn")!.addEventListener("click", () => dlg!.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg!.close(); });
    dlg.addEventListener("close", () => { v.pause(); v.removeAttribute("src"); v.innerHTML = ""; v.load(); });
  }
  root.querySelectorAll<HTMLElement>(".clip").forEach((f) => f.querySelector(".clip-open")!.addEventListener("click", () => {
    const id = f.dataset.clip as Clip["id"], v = dlg!.querySelector("video")!;
    dlg!.querySelector("#clip-dlg-t")!.textContent = CLIPS[id].title;
    v.innerHTML = sources(id); v.poster = `./media/${id}.jpg`; v.load(); dlg!.showModal(); v.play().catch(() => {});
  }));
}
