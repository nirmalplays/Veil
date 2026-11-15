import { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CpuIcon, SquareLock02Icon, SignatureIcon, CheckmarkBadge01Icon, SourceCodeIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import ScrollReveal from "../rb/ScrollReveal/ScrollReveal";
import DecryptedText from "../rb/DecryptedText/DecryptedText";
import CountUp from "../rb/CountUp/CountUp";
import LogoLoop from "../rb/LogoLoop/LogoLoop";
import SpotlightCard from "../rb/SpotlightCard/SpotlightCard";
import Magnet from "../rb/Magnet/Magnet";
import { e2eeEncryptKeep } from "../../../client/src/e2ee.js";
import type { FlowEvent } from "../flow-meta";
import { reduced } from "../fx";
import { Film, FILMS } from "./media";

gsap.registerPlugin(ScrollTrigger);

interface Recorded { recordedAt: string; question: string; answer: string; events: FlowEvent[] }
function useRecording() {
  const [r, setR] = useState<Recorded | null>(null);
  useEffect(() => { fetch("./recorded-run.json").then((x) => (x.ok ? x.json() : null)).then(setR).catch(() => {}); }, []);
  return r;
}
const openChat = () => {
  const host = [...document.body.children].find((el) => el.shadowRoot?.querySelector(".fab"));
  host?.shadowRoot?.querySelector<HTMLButtonElement>(".fab")?.click();
};

/* ---------------------------------------------------------------- hero */
function Hero({ rec }: { rec: Recorded | null }) {
  const ref = useRef<HTMLElement>(null);
  const checks = rec ? rec.events.filter((e) => e.stage === "verify" && e.kind === "ok").length - 1 : 15;
  useGSAP(() => {
    if (reduced) return;
    // the hero screen recedes into the page as you scroll away
    gsap.to(".hero-screen", { scrollTrigger: { trigger: ref.current, start: "top top", end: "bottom top", scrub: true }, rotateX: 14, scale: 0.86, borderRadius: 40, ease: "none" });
    gsap.fromTo(".hw", { opacity: 0, yPercent: 60, filter: "blur(10px)" }, { opacity: 1, yPercent: 0, filter: "blur(0px)", duration: 1.1, stagger: 0.07, ease: "expo.out", delay: 0.15 });
    gsap.to(".hero-copy", { scrollTrigger: { trigger: ref.current, start: "top top", end: "60% top", scrub: true }, y: -80, opacity: 0, ease: "none" });
  }, { scope: ref });
  return (
    <section className="h-hero" ref={ref} aria-labelledby="hero-h">
      <div className="hero-screen">
        <Film src={FILMS.enclave} eager className="hero-film" />
        <div className="hero-grade" />
      </div>
      <div className="wrap hero-in">
        <div className="hero-copy">
          <span className="eyebrow"><span className="dot" />Private AI on NEAR</span>
          <h1 id="hero-h" className="display hero-h">{["AI", "you", "can"].map((w) => <span key={w} className="hw">{w}</span>)}<span className="hw accent">check,</span><br />{["not", "just", "trust."].map((w) => <span key={w} className="hw">{w}</span>)}</h1>
          <p className="lede hero-lede">Your words are encrypted in your browser to an AI running inside sealed, hardware-verified chips. The site, its server and the network carry them. None of them can read them.</p>
          <div className="hero-cta">
            <Magnet padding={60} magnetStrength={4}><a className="star big" href="/live"><span>Watch a message go through</span></a></Magnet>
            <a className="btn ghost" href="/docs">Read the docs</a>
          </div>
        </div>
        <aside className="hero-side" aria-label="From a real run">
          <div className="stat glass">
            <span className="stat-n"><CountUp to={checks} duration={2.2} /></span>
            <span className="stat-l">hardware checks your browser runs before it encrypts a single word</span>
            <span className="stat-k mono">Intel TDX · NVIDIA GPUs · gateway</span>
          </div>
          <div className="stat glass">
            <span className="stat-n"><CountUp to={0} from={1381} duration={2.6} separator="," /><small>bytes</small></span>
            <span className="stat-l">of your message the relay can read</span>
          </div>
          <nav className="side-links glass" aria-label="Try it">
            <span className="mono side-t">Try it now</span>
            <a href="/live"><b>Live view</b><span>A real message, every step logged</span><HugeiconsIcon icon={ArrowRight01Icon} size={16} /></a>
            <button type="button" onClick={openChat}><b>Demo chat</b><span>Ask a fictional law firm anything</span><HugeiconsIcon icon={ArrowRight01Icon} size={16} /></button>
          </nav>
        </aside>
      </div>
      <span className="scroll-cue mono" aria-hidden="true">Scroll</span>
    </section>
  );
}

/* ---------------------------------------------------------------- statement */
function Statement() {
  return (
    <section className="h-statement" aria-label="Why Veil">
      <div className="wrap">
        <span className="eyebrow">01 · The problem</span>
        <ScrollReveal baseOpacity={0.08} enableBlur baseRotation={2} blurStrength={6} containerClassName="statement" textClassName="statement-t">
          Every AI company says it protects your data. Not one of them lets you check. Veil does: the hardware your words run on, the rules the AI was given, and every answer it signs.
        </ScrollReveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- the cipher (signature moment) */
const KEY = "5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff";
function Cipher({ rec }: { rec: Recorded | null }) {
  const [text, setText] = useState("My landlord kept my deposit. Can I get it back?");
  const [tick, setTick] = useState(0);
  const key = useMemo(() => rec?.events.find((e) => e.text.startsWith("Pinned the enclave key"))?.data ?? KEY, [rec]);
  const cipher = useMemo(() => (text ? e2eeEncryptKeep(text, key).data : ""), [text, key, tick]);
  useEffect(() => { if (reduced) return; const t = setInterval(() => setTick((n) => n + 1), 2600); return () => clearInterval(t); }, []);
  return (
    <section className="h-cipher" aria-labelledby="cipher-h">
      <div className="wrap cipher-grid">
        <div className="cipher-head">
          <span className="eyebrow">02 · Try it here</span>
          <h2 id="cipher-h" className="h2">Type something <span className="accent">private.</span></h2>
          <p className="lede">This box encrypts with Veil's real code, in this tab, to an enclave key that passed every hardware check. The right side is all the site, its server and the network ever get. It changes on every keystroke because each message gets a fresh one-time key.</p>
        </div>
        <SpotlightCard className="cipher-card" spotlightColor="rgba(139, 112, 255, 0.22)" theme="dark">
          <label className="mono cipher-l" htmlFor="c-in">You type</label>
          <input id="c-in" className="cipher-in" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} />
          <div className="cipher-sep mono" aria-hidden="true"><span />XChaCha20-Poly1305 · X25519<span /></div>
          <span className="mono cipher-l">They get</span>
          <p className="cipher-out mono" aria-live="off">{cipher || "Nothing yet. Nothing leaves this tab until you send."}</p>
          <p className="mono cipher-meta">{text ? `${new TextEncoder().encode(text).length} bytes in → ${cipher.length / 2} bytes out · key ${key.slice(0, 12)}…` : ""}</p>
        </SpotlightCard>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- the loop (light section) */
const STEPS = [
  { k: "Ask", t: "Check the rules", d: "Your browser fetches the site's rules and compares their fingerprint with the one registered on NEAR. If they differ, the chat stays off." },
  { k: "Attest", t: "Demand proof", d: "A fresh random nonce goes to the model's enclave. It answers with a proof signed by the hardware itself, so an old one can't be replayed." },
  { k: "Verify", t: "Check the chips", d: "Intel's quote, NVIDIA's GPU tokens, the boot log and the container measurements are verified in your browser. The key is pinned only if all of them pass." },
  { k: "Encrypt", t: "Seal the message", d: "Your words are encrypted to that pinned key. From here on, only the verified enclave can open them." },
  { k: "Answer", t: "Cross the relay", d: "The site's relay adds its API key and forwards ciphertext. The answer comes back encrypted to a one-time key only your tab holds." },
  { k: "Prove", t: "Sign every answer", d: "The enclave signs the exact bytes. Anyone can check the receipt later, including whether the answer obeyed the registered rules." },
];
function Orbit({ active }: { active: number }) {
  const n = STEPS.length, R = 118;
  return (
    <svg className="orbit" viewBox="-170 -170 340 340" aria-hidden="true">
      <circle r={R} className="o-ring" />
      <circle r={R} className="o-prog" style={{ strokeDasharray: `${2 * Math.PI * R}`, strokeDashoffset: `${2 * Math.PI * R * (1 - (active + 1) / n)}` }} transform="rotate(-90)" />
      <g style={{ transform: `rotate(${-active * (360 / n)}deg)` }} className="o-rot">
        {STEPS.map((s, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2, x = Math.cos(a) * R, y = Math.sin(a) * R;
          return (
            <g key={s.k} transform={`translate(${x} ${y})`}>
              <circle r={i === active ? 7 : 4.5} className={`o-dot ${i <= active ? "on" : ""}`} />
              <g style={{ transform: `rotate(${active * (360 / n)}deg)` }} className="o-rot"><text y={-16} className={`o-lab ${i === active ? "on" : ""}`}>{String(i + 1).padStart(2, "0")} {s.k.toUpperCase()}</text></g>
            </g>
          );
        })}
      </g>
      <text className="o-center" y={10}>{STEPS[active].k}</text>
    </svg>
  );
}
function Loop({ rec }: { rec: Recorded | null }) {
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLElement>(null);
  useGSAP(() => {
    gsap.utils.toArray<HTMLElement>(".step").forEach((el, i) => {
      ScrollTrigger.create({ trigger: el, start: "top 55%", end: "bottom 55%", onToggle: (s) => s.isActive && setActive(i) });
    });
  }, { scope: ref });
  const real = useMemo(() => {
    if (!rec) return [] as string[];
    const by = (st: string) => rec.events.filter((e) => e.stage === st);
    return [
      (by("policy").find((e) => e.kind === "ok")?.text ?? "").replace("Matches the registered policy", "Matched NEAR"),
      by("attest").find((e) => e.kind === "ok")?.text.replace("Attestation received: ", "") ?? "",
      `${by("verify").filter((e) => e.kind === "ok").length - 1} checks passed · ${by("verify").find((e) => e.text.startsWith("Pinned"))?.text.match(/TCB \w+/)?.[0] ?? ""}`,
      by("encrypt").find((e) => e.text.startsWith("Encrypted"))?.text.replace("Encrypted your message: ", "") ?? "",
      by("send").find((e) => e.kind === "ok")?.text ?? "",
      `${by("receipt").filter((e) => e.kind === "ok").length - 1} receipt checks passed`,
    ];
  }, [rec]);
  return (
    <section className="h-loop" ref={ref} aria-labelledby="loop-h">
      <div className="wrap">
        <div className="loop-words" aria-hidden="true">
          {STEPS.map((s, i) => <span key={s.k} className={i === active ? "on" : ""}>{s.k}</span>)}
        </div>
        <div className="loop-head">
          <span className="eyebrow ink">03 · How it works</span>
          <h2 id="loop-h" className="h2 ink">We don't ask for trust. <span className="accent">We hand you the proof.</span></h2>
        </div>
        <div className="loop-grid">
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.k} className={`step ${i === active ? "on" : ""}`}>
                <span className="step-n">{String(i + 1).padStart(2, "0")}</span>
                <div><h3>{s.t}</h3><p>{s.d}</p>{real[i] && <p className="mono step-real">Recorded run: {real[i]}</p>}</div>
              </li>
            ))}
          </ol>
          <div className="loop-card-wrap">
            <div className="loop-card">
              <Film src={FILMS.mesh} className="loop-film" />
              <div className="loop-card-grade" />
              <div className="loop-card-top mono"><span>The loop</span><span>{String(active + 1).padStart(2, "0")} / 06</span></div>
              <Orbit active={active} />
              <p className="loop-card-foot mono">{active < 5 ? `Next: ${STEPS[active + 1].k}` : "Every message, every time."}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- visitors / owners */
function Split() {
  const ref = useRef<HTMLElement>(null);
  useGSAP(() => {
    if (reduced) return;
    gsap.utils.toArray<HTMLElement>(".split-card").forEach((c, i) => {
      gsap.fromTo(c, { y: 120 + i * 60, opacity: 0.3 }, { y: 0, opacity: 1, ease: "none", scrollTrigger: { trigger: c, start: "top bottom", end: "top 40%", scrub: true } });
      gsap.fromTo(c.querySelector(".split-big"), { yPercent: 30, opacity: 0 }, { yPercent: 0, opacity: 1, ease: "none", scrollTrigger: { trigger: c, start: "top 85%", end: "top 25%", scrub: true } });
    });
  }, { scope: ref });
  return (
    <section className="h-split" ref={ref} aria-label="Who Veil is for">
      <div className="wrap split-grid">
        <article className="split-card">
          <Film src={FILMS.globe} className="split-film" />
          <div className="split-grade" />
          <span className="split-k mono">For visitors</span>
          <div className="split-foot"><span className="split-big">Ask</span><div className="split-copy"><p>Ask anything. Then check the hardware, the rules and the signed receipt yourself.</p><a className="split-link" href="/docs#visitors">What the checks mean <HugeiconsIcon icon={ArrowRight01Icon} size={15} /></a></div></div>
        </article>
        <article className="split-card">
          <Film src={FILMS.fan} className="split-film" />
          <div className="split-grade" />
          <span className="split-k mono">For site owners</span>
          <div className="split-foot"><span className="split-big">Build</span><div className="split-copy"><p>One script tag, rules fingerprinted on NEAR, and a relay you can host for free.</p><a className="split-link" href="/docs#owners">Add it to your site <HugeiconsIcon icon={ArrowRight01Icon} size={15} /></a></div></div>
        </article>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- marquee */
const TECH = ["Intel TDX", "NVIDIA H100", "NEAR Protocol", "NEAR AI Cloud", "XChaCha20-Poly1305", "X25519", "Ed25519", "SHA-256", "Merkle proofs", "NEP-413"];
const PROMISES = ["Encrypted in your browser", "Rules fingerprinted on chain", "Every answer signed", "No cookies", "Nothing stored", "One script tag", "Open source"];
function Marquee() {
  const row = (items: string[]) => items.map((t) => ({ node: <span className="mq-item">{t}<i>•</i></span>, title: t }));
  return (
    <section className="h-marquee" aria-label="Built on">
      <LogoLoop logos={row(TECH)} speed={60} direction="left" logoHeight={64} gap={28} pauseOnHover fadeOut fadeOutColor="#060608" ariaLabel="Technology Veil is built on" />
      <LogoLoop logos={row(PROMISES)} speed={45} direction="right" logoHeight={64} gap={28} pauseOnHover fadeOut fadeOutColor="#060608" ariaLabel="What Veil promises" className="mq-dim" />
    </section>
  );
}

/* ---------------------------------------------------------------- who sees what */
type Cell = { s: "plain" | "cipher" | "none" | "public" | "meta"; t: string };
const ITEMS = ["Your message", "The answer", "The API key", "The rules", "Metadata"];
const PARTIES: { id: string; name: string; note: string; cells: Cell[] }[] = [
  { id: "relay", name: "The site's relay", note: "The site owner's small server. It adds the API key and forwards bytes it cannot open.", cells: [{ s: "cipher", t: "" }, { s: "cipher", t: "Encrypted to your one-time key." }, { s: "plain", t: "Holds it, so your browser never needs one." }, { s: "public", t: "Serves them. A change wouldn't match NEAR." }, { s: "meta", t: "Time, IP address, size." }] },
  { id: "you", name: "You", note: "Everything starts and ends in your tab, and nothing is stored there either.", cells: [{ s: "plain", t: "" }, { s: "plain", t: "Decrypted here, with a key only this tab holds." }, { s: "none", t: "Never sent to you." }, { s: "public", t: "Public, and checked against NEAR." }, { s: "meta", t: "Yours." }] },
  { id: "host", name: "Hosting company", note: "This demo's relay runs on ordinary hosting, not in a TEE, so the host could read the API key. Your messages are still out of reach.", cells: [{ s: "cipher", t: "" }, { s: "cipher", t: "Ciphertext." }, { s: "plain", t: "Could read it. No TEE here, and the widget says so." }, { s: "public", t: "Public." }, { s: "meta", t: "Time, IP address, size." }] },
  { id: "net", name: "The network", note: "Wi-Fi owners and ISPs see TLS, and inside it, more ciphertext.", cells: [{ s: "cipher", t: "" }, { s: "cipher", t: "Ciphertext inside TLS." }, { s: "none", t: "Inside TLS." }, { s: "public", t: "Public." }, { s: "meta", t: "That you connected." }] },
  { id: "enclave", name: "The AI enclave", note: "Intel TDX with NVIDIA GPUs in confidential mode. It reads your words there, after your browser verified it.", cells: [{ s: "plain", t: "" }, { s: "plain", t: "Writes it, then encrypts it to you." }, { s: "none", t: "Not needed." }, { s: "plain", t: "Receives the prompt." }, { s: "meta", t: "Only the request." }] },
  { id: "near", name: "NEAR", note: "The chain never sees a conversation. It holds a fingerprint of the rules.", cells: [{ s: "none", t: "Nothing." }, { s: "none", t: "Nothing." }, { s: "none", t: "Nothing." }, { s: "public", t: "Only their SHA-256 fingerprint." }, { s: "none", t: "Nothing." }] },
];
const LABEL = { plain: "Readable", cipher: "Ciphertext", none: "Nothing", public: "Public", meta: "Metadata" };
function WhoSees() {
  const [p, setP] = useState(0);
  const sample = "My landlord kept my deposit.";
  const hex = useMemo(() => e2eeEncryptKeep(sample, KEY).data.slice(0, 96), [p]);
  const party = PARTIES[p];
  return (
    <section className="h-who" aria-labelledby="who-h">
      <div className="wrap">
        <div className="who-head">
          <span className="eyebrow">04 · Who sees what</span>
          <h2 id="who-h" className="h2">Pick a party. <span className="accent">See what it gets.</span></h2>
        </div>
        <div className="who-tabs" role="tablist" aria-label="Parties">
          {PARTIES.map((x, i) => <button key={x.id} role="tab" aria-selected={i === p} className={`chip ${i === p ? "on" : ""}`} onClick={() => setP(i)}>{x.name}</button>)}
        </div>
        <div className="who-grid" role="tabpanel">
          {party.cells.map((c, i) => (
            <SpotlightCard key={party.id + i} className={`who-cell ${c.s}`} spotlightColor="rgba(139, 112, 255, 0.18)" theme="dark">
              <span className="mono who-k">{ITEMS[i]}</span>
              <span className="mono who-s">{LABEL[c.s]}</span>
              {i === 0 && c.s === "cipher" ? <p className="mono who-hex"><DecryptedText text={hex} animateOn="view" speed={18} maxIterations={6} characters="0123456789abcdef" /></p>
                : <p>{i === 0 && c.s === "plain" ? `“${sample}”` : c.t}</p>}
            </SpotlightCard>
          ))}
        </div>
        <p className="who-note">{party.note}</p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- different by design */
const FEATURES = [
  { icon: SquareLock02Icon, t: "Encrypted before it leaves", d: "Your browser encrypts to a key that lives inside the verified chip. Not the site, not us, not the network." },
  { icon: CpuIcon, t: "Hardware you can verify", d: "Intel and NVIDIA sign the proof. Your browser checks the signature, the boot log and the containers." },
  { icon: CheckmarkBadge01Icon, t: "Rules that can't drift", d: "The prompt and every checkable rule are fingerprinted on NEAR. A silent change switches the chat off." },
  { icon: SignatureIcon, t: "A receipt for every answer", d: "The enclave signs the exact bytes. Save the receipt, hand it to anyone, and they can check it." },
  { icon: SourceCodeIcon, t: "One script tag", d: "Paste it into any site. No cookies, nothing stored, and the relay runs on a free host." },
];
function Different() {
  return (
    <section className="h-diff" aria-labelledby="diff-h">
      <div className="wrap">
        <div className="diff-head">
          <span className="eyebrow">05 · Different by design</span>
          <h2 id="diff-h" className="h2">Privacy you don't have to <span className="accent">take on faith.</span></h2>
        </div>
        <div className="diff-grid">
          {FEATURES.map((f, i) => (
            <SpotlightCard key={f.t} className="diff-card" spotlightColor="rgba(139, 112, 255, 0.2)" theme="dark">
              <span className="diff-ic"><HugeiconsIcon icon={f.icon} size={22} /></span>
              <span className="diff-n">{String(i + 1).padStart(2, "0")}</span>
              <h3>{f.t}</h3>
              <p>{f.d}</p>
            </SpotlightCard>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- built for */
const BUILT = ["Encrypt in the browser.", "Verify the hardware.", "Prove every answer."];
function Built() {
  const ref = useRef<HTMLElement>(null);
  useGSAP(() => {
    if (reduced) return;
    gsap.utils.toArray<HTMLElement>(".built-line").forEach((l) => gsap.fromTo(l, { opacity: 0.18 }, { opacity: 1, ease: "none", scrollTrigger: { trigger: l, start: "top 85%", end: "top 45%", scrub: true } }));
    gsap.fromTo(".built-film", { scale: 1.2 }, { scale: 1, ease: "none", scrollTrigger: { trigger: ref.current, start: "top bottom", end: "bottom top", scrub: true } });
  }, { scope: ref });
  return (
    <section className="h-built" ref={ref} aria-labelledby="built-h">
      <Film src={FILMS.nebula} className="built-film" />
      <div className="built-grade" />
      <div className="wrap built-in">
        <h2 id="built-h" className="built-h">Built for<br />private questions.</h2>
        <div className="built-lines">{BUILT.map((b) => <p key={b} className="built-line">{b}</p>)}</div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- final */
function Final() {
  return (
    <section className="h-final" aria-labelledby="final-h">
      <Film src={FILMS.bands} className="final-film" />
      <div className="final-grade" />
      <div className="wrap final-in">
        <h2 id="final-h" className="display final-h">Have something <span className="accent">private</span> to ask?</h2>
        <p className="lede">Ask the demo assistant, or watch a real message cross the wire, every proof included.</p>
        <div className="final-cta">
          <button type="button" className="star big" onClick={openChat}><span>Open the chat</span></button>
          <a className="btn ghost" href="/live">Watch it live</a>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const rec = useRecording();
  useEffect(() => { const t = setTimeout(() => ScrollTrigger.refresh(), 800); return () => clearTimeout(t); }, [rec]);
  return (
    <>
      <Hero rec={rec} />
      <Statement />
      <Cipher rec={rec} />
      <Loop rec={rec} />
      <Split />
      <Marquee />
      <WhoSees />
      <Different />
      <Built />
      <Final />
    </>
  );
}
