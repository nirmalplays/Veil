// Background films. These are free backgrounds from motionsites.ai (offered for use via "Copy URL"), served from their CDN.
// They are placeholders until Veil's own videos are generated from the adapted prompts in site/PROMPTS.md.
import { useEffect, useRef } from "react";
import { reduced } from "../fx";

export const FILMS = {
  enclave: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260806_133255_956f653f-5d80-4b06-abd5-0f46c98b60fa.mp4",
  door: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260808_112712_da9d53df-6d27-4b12-bdf6-aa9dc2622bdf.mp4",
  globe: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_051048_5ef213b5-26db-4da8-b604-7ef823760b6b.mp4",
  fan: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260418_115655_b4d9cd77-feed-43cd-a198-af78ebdf1f7a.mp4",
  bands: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260629_021419_291eb2af-5ed4-45a0-a1d6-3ef58f4bca0b.mp4",
  nebula: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260815_030633_1712fc71-4979-4e14-98f9-9f95702ab3da.mp4",
  mesh: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_135039_b04d00db-6ee2-4e2a-a7f5-b2dfd3d24fd2.mp4",
} as const;

/** A muted looping film that loads only when it is about to scroll into view, and pauses when it leaves. */
export function Film({ src, className = "", eager = false }: { src: string; className?: string; eager?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current!;
    const load = () => { if (!v.getAttribute("src")) { v.src = src; v.load(); } };
    if (eager) load();
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { load(); if (!reduced) v.play().catch(() => {}); } else v.pause();
    }, { rootMargin: "400px 0px" });
    io.observe(v);
    return () => io.disconnect();
  }, [src, eager]);
  return <video ref={ref} className={`film ${className}`} muted loop playsInline preload={eager ? "auto" : "none"} aria-hidden="true" />;
}

/** One of Veil's own screen recordings (site/public/media). */
export function Recording({ id }: { id: "run" | "chat" | "type" }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current!;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && !reduced) { v.preload = "auto"; v.play().catch(() => {}); } else v.pause(); }, { threshold: 0.3 });
    io.observe(v); return () => io.disconnect();
  }, []);
  return (
    <video ref={ref} className="rec-video" muted loop playsInline preload="none" poster={`./media/${id}.jpg`}>
      <source src={`./media/${id}.webm`} type="video/webm" /><source src={`./media/${id}.mp4`} type="video/mp4" />
    </video>
  );
}
