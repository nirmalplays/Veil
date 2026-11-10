import { useEffect, useRef } from "react";
import { SealDemo } from "./SealDemo";
import { CONTRACT, EXPLORER } from "./config";
import "./landing.css";

const READS: { stage: string; you: string; tee: string; store: string; chain: string; owner: string }[] = [
  { stage: "You chat", you: "Plaintext", tee: "Plaintext, inside the enclave", store: "Nothing", chain: "Nothing", owner: "Nothing" },
  { stage: "You save the session", you: "Plaintext", tee: "Nothing", store: "Ciphertext", chain: "Hash and pointer", owner: "Nothing" },
  { stage: "You grant consent", you: "Plaintext", tee: "Nothing", store: "Ciphertext", chain: "Hash, expiry, wrapped key", owner: "Can open this one session" },
  { stage: "The owner scores it", you: "Plaintext", tee: "Nothing", store: "Ciphertext", chain: "Score, attestation hash", owner: "Plaintext" },
  { stage: "You revoke", you: "Plaintext", tee: "Nothing", store: "Ciphertext", chain: "Wrapped key deleted", owner: "Excluded from the next answer and round" },
];

function Motion() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (matchMedia("(prefers-reduced-motion: reduce)").matches) ref.current?.pause(); }, []);
  return (
    <figure className="motion">
      <video ref={ref} src="/architecture-motion.mp4" autoPlay loop muted playsInline controls
        aria-label="Animation: a session is sealed, stored, shared with consent, read and scored by the model owner, verified, and revoked." />
      <figcaption>A session's trip through the system, 30 seconds. <a href="/architecture-motion.gif" download>Download the GIF</a></figcaption>
    </figure>
  );
}

export function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <a className="lp-brand" href="#/">Veil</a>
        <nav aria-label="Sections">
          <a href="#how">How it works</a><a href="#architecture">Architecture</a><a href="#useful">Who it helps</a><a href="#usecase">Use case</a>
        </nav>
        <a className="btn btn-solid" href="#/app">Open the app</a>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>Chat privately. Decide who gets to use it.</h1>
          <p className="lede">Veil seals every conversation in your browser. A model owner can read a session only while your consent is live, and anyone can check afterwards exactly which sessions were used.</p>
          <div className="hero-cta">
            <a className="btn btn-solid" href="#/app">Open the app</a>
            <a className="btn btn-line" href="#how">See how a session travels</a>
          </div>
          <p className="hero-meta">Runs on NEAR testnet. Private inference by NEAR AI Cloud. Built for the NEAR Hackathon, Privacy and Private AI track.</p>
        </div>
        <SealDemo />
      </section>

      <section className="band" id="problem">
        <h2>Today you have to trust everyone in the chain</h2>
        <div className="three">
          <div><h3>Platforms read everything</h3><p>The operator of a chat product can see every prompt. You cannot control who uses it or check what happened.</p></div>
          <div><h3>Model builders can't get honest data</h3><p>Real conversations are the best context a model can have, and the only ways to get them are scraping or taking a company's word.</p></div>
          <div><h3>"Private AI" is mostly a promise</h3><p>Claims about privacy rarely come with something you can verify yourself.</p></div>
        </div>
      </section>

      <section className="how" id="how">
        <h2>Who can read a session, and when</h2>
        <p className="sec-lede">Follow one conversation from the first message to revoking consent. Read across to see what each party holds at that moment.</p>
        <div className="tablewrap">
          <table>
            <thead><tr><th scope="col">Step</th><th scope="col">You</th><th scope="col">NEAR AI enclave</th><th scope="col">Storage</th><th scope="col">NEAR chain</th><th scope="col">Model owner</th></tr></thead>
            <tbody>
              {READS.map((r, i) => (
                <tr key={r.stage}>
                  <th scope="row"><span className="stepn">{i + 1}</span>{r.stage}</th>
                  <td className={r.you === "Plaintext" ? "plain" : ""}>{r.you}</td>
                  <td className={r.tee.startsWith("Plaintext") ? "plain" : ""}>{r.tee}</td>
                  <td>{r.store}</td><td>{r.chain}</td>
                  <td className={r.owner === "Plaintext" || r.owner.startsWith("Can open") ? "plain" : ""}>{r.owner}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
        <p className="fine">Highlighted cells are the only places plaintext can exist. Everything else holds ciphertext, hashes or keys.</p>
      </section>

      <section className="arch" id="architecture">
        <div className="arch-in">
          <h2>Architecture</h2>
          <p className="sec-lede">Five parts. The browser does the sealing. NEAR holds the facts that need to be public and tamper-proof. Storage holds bytes it cannot read.</p>
          <Motion />
          <dl className="arch-notes">
            <div><dt>Browser</dt><dd>Seals sessions with AES-256-GCM, bound to your account. Signs in with NEP-413. Wraps your session key for a model owner only when you say so.</dd></div>
            <div><dt>NEAR AI Cloud</dt><dd>Runs the model inside a hardware enclave. The app fetches an attestation with a fresh nonce and checks that the model's key is bound to it before sending anything.</dd></div>
            <div><dt>NEAR contract</dt><dd>Stores hashes, consent records with expiry, scores, site policies, and one Merkle root per round. It never sees plaintext.</dd></div>
            <div><dt>Model owner</dt><dd>Registers a public key. Reads only the sessions with live consent, scores them for relevance or uses the relevant ones as context for answers, and anchors the round.</dd></div>
          </dl>
        </div>
      </section>

      <section className="useful" id="useful">
        <h2>Who it helps</h2>
        <div className="rows">
          <article>
            <h3>People who chat about sensitive work</h3>
            <p>A lawyer drafting terms, a clinician summarising notes, a founder working through a fundraise. You get a capable model without handing the transcript to the operator. If you want your session to help improve a model, you pick which model, for how long, and you can take it back.</p>
          </article>
          <article>
            <h3>Teams building domain models</h3>
            <p>You get conversations from people who agreed to share them, scored for relevance to your model. Each round carries a Merkle root on-chain, so you can prove which sessions were scored or used, and contributors can prove theirs were.</p>
          </article>
          <article>
            <h3>Auditors and reviewers</h3>
            <p>Every claim has a check you can run: the attestation hash behind a score, the root behind a round, the inclusion proof for one session. Nothing relies on the operator being honest about it.</p>
          </article>
        </div>
      </section>

      <section className="usecase" id="usecase">
        <h2>A company example: an AI coding assistant sold to banks</h2>
        <p className="sec-lede">An illustration with made-up companies. It uses only what this prototype does today.</p>
        <figure className="uc-video">
          <video src="/usecase-video.mp4" controls playsInline preload="metadata" aria-label="Screen recording of the Ledgerline and Brightwell example, with captions for each step." />
          <figcaption>The example, end to end on testnet with NEAR AI's attested model, about two minutes. Waiting time is fast-forwarded. <a href="/usecase-video.gif" download>Download the GIF</a></figcaption>
        </figure>
        <div className="uc-grid">
          <div>
            <h3>The standoff</h3>
            <p><b>Ledgerline</b> sells a coding assistant to fintech engineering teams. Its assistant answers better when it can draw on real compliance-heavy code, which is exactly what it can't get: <b>Brightwell Bank</b> bans cloud assistants because vendor terms allow training on prompts. Engineers use personal accounts anyway, so the bank has the risk and no oversight, and Ledgerline has no path to the data.</p>
          </div>
          <div>
            <h3>With Veil</h3>
            <p>Brightwell's engineers use the assistant. Every session is sealed on their machine, and Ledgerline cannot read any of them. After a session, an engineer can share it with Ledgerline's model for 30 days. Ledgerline gets those sessions only, and the bank can prove what was and wasn't used.</p>
          </div>
        </div>
        <div className="tablewrap">
          <table className="uc-table">
            <thead><tr><th scope="col">Who</th><th scope="col">What they do</th><th scope="col">What they get</th></tr></thead>
            <tbody>
              <tr><th scope="row">Engineer at Brightwell</th><td>Works with the assistant all day. Shares a generic refactoring session. Keeps a session about the payments ledger private.</td><td>A capable assistant with no transcript sitting on the vendor's servers. A switch per session, with an expiry.</td></tr>
              <tr><th scope="row">Ledgerline's ML team</th><td>Registers a model and a key. Each week, loads the sessions with live consent, scores them for relevance, uses the relevant ones as context when answering, and anchors a round.</td><td>Consented, relevance-scored context. A Merkle root per round that shows exactly which sessions were used.</td></tr>
              <tr><th scope="row">Brightwell's security lead</th><td>Takes a round root from Ledgerline and checks a sample of engineers' sessions against it. Asks engineers to revoke when a project turns sensitive.</td><td>Evidence instead of a promise: unshared sessions never appear in any round or answer, and shared ones are provably the ones used.</td></tr>
            </tbody>
          </table>
        </div>
        <div className="uc-grid uc-after">
          <div>
            <h3>What changes for each side</h3>
            <p>Ledgerline can answer the clause that blocks enterprise deals: "we only use what your engineers choose to share, and you can verify it." Brightwell can approve the tool, because opting in is per session, expires on its own, and leaves an audit trail.</p>
          </div>
          <div>
            <h3>What the company still has to own</h3>
            <p>Once Ledgerline decrypts a shared session, it holds that plaintext and needs its own controls. Revoking removes a session from the next answer and the next round. Nothing is trained, so there are no model weights to un-train, but it does not erase what Ledgerline already read. A production rollout also needs mainnet, managed key storage for the model owner, and a legal review of the consent wording.</p>
          </div>
        </div>
      </section>

      <section className="try" id="try">
        <h2>Try it in five minutes</h2>
        <ol>
          <li>Open the app and create an inline testnet wallet. No extension needed.</li>
          <li>Chat, then choose "Encrypt, upload and commit". Your hash appears on NEAR.</li>
          <li>Register a model, then grant it consent from "My sessions".</li>
          <li>As the model owner, score the session and anchor the round.</li>
          <li>Open "Verify inclusion" and confirm your session is in the anchored root.</li>
        </ol>
        <div className="hero-cta">
          <a className="btn btn-solid" href="#/app">Open the app</a>
          <a className="btn btn-line" href={`${EXPLORER}/accounts/${CONTRACT}`} target="_blank" rel="noreferrer">View the contract on testnet</a>
        </div>
      </section>

      <footer className="lp-foot">
        <span>Veil. Concept from Veil, rebuilt from scratch on NEAR during the hackathon.</span>
        <span className="mono">{CONTRACT}</span>
      </footer>
    </div>
  );
}
