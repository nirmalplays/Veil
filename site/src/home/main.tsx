// Home page: a React app built from ReactBits components, with smooth scrolling (Lenis) driving GSAP's scroll triggers.
import { createRoot } from "react-dom/client";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { chrome } from "../chrome";
import { reduced } from "../fx";
import Home from "./Home";
import "./home.css";

chrome("home");
gsap.registerPlugin(ScrollTrigger);
if (!reduced) {
  const lenis = new Lenis({ duration: 1.15, smoothWheel: true, wheelMultiplier: 0.95 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  // in-page anchors scroll smoothly too
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.('a[href^="#"]') as HTMLAnchorElement | null;
    if (a && a.hash.length > 1) { e.preventDefault(); lenis.scrollTo(a.hash, { offset: -90 }); }
  });
}
createRoot(document.getElementById("root")!).render(<Home />);
