import { useEffect, useRef } from "react";
import { SealDemo } from "./SealDemo";
import { CONTRACT, EXPLORER } from "./config";

/** Where the embeddable widget demo runs (a local page: see widget/README.md). */
const WIDGET_DEMO: string = import.meta.env.VITE_WIDGET_DEMO_URL ?? "http://localhost:5174/demo/index.html";
import "./landing.css";

const READS: { stage: string; you: string; tee: string; store: string; chain: string; owner: string }[] = [
  { stage: "You chat", you: "Plaintext", tee: "Plaintext, inside the enclave", store: "Nothing", chain: "Nothing", owner: "Nothing" },
  { stage: "You save the session", you: "Plaintext", tee: "Nothing", store: "Ciphertext", chain: "Hash and pointer", owner: "Nothing" },
  { stage: "You grant consent", you: "Plaintext", tee: "Nothing", store: "Ciphertext", chain: "Hash, expiry, wrapped key", owner: "Can open this one session" },
  { stage: "The owner scores it", you: "Plaintext", tee: "Nothing", store: "Ciphertext", chain: "Score, attestation hash", owner: "Plaintext" },
  { stage: "A question is answered with it", you: "Plaintext", tee: "Plaintext, inside the enclave (sent encrypted)", store: "Ciphertext", chain: "Round root, if recorded", owner: "Plaintext" },
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
          <a href="#verify">Verifiable answers</a><a href="#compare">Compare</a><a href="#how">How it works</a><a href="#usecase">Use case</a><a href="#faq">FAQ</a>
        </nav>
        <a className="btn btn-solid" href="#/app">Open the app</a>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>AI you can check, not just trust.</h1>
          <p className="lede">Every AI company says it protects your data. Veil lets you verify it. Your messages are encrypted in your browser to a hardware-attested enclave, the rules a business gives its AI are registered on NEAR, and every answer can come with a receipt anyone can check.</p>
          <div className="hero-cta">
            <a className="btn btn-solid" href="#/app">Start a private chat</a>
            <a className="btn btn-line" href={WIDGET_DEMO}>See it on a website</a>
          </div>
          <ul className="proofs" aria-label="What you can check">
            <li>Intel TDX + NVIDIA attested</li><li>Rules registered on NEAR</li><li>Signed receipts</li><li>Nothing trained on your chats</li>
          </ul>
          <p className="hero-meta">Private inference by NEAR AI Cloud. Runs on NEAR testnet. Built for the NEAR Hackathon, Privacy and Private AI track.</p>
        </div>
        <SealDemo />
      </section>

      <section className="band" id="problem">
        <h2>Everyone says "private". Nobody shows you.</h2>
        <div className="three">
          <div><h3>Platforms read everything</h3><p>The operator of a chat product can see every prompt. You cannot control who uses it or check what happened.</p></div>
          <div><h3>Model builders can't get honest data</h3><p>Real conversations are the best context a model can have, and the only ways to get them are scraping or taking a company's word.</p></div>
          <div><h3>"Private AI" is mostly a promise</h3><p>Claims about privacy rarely come with something you can verify yourself.</p></div>
        </div>
      </section>

      <section className="verify" id="verify">
        <h2>Rules a site can't quietly change</h2>
        <p className="sec-lede">A company can say its AI follows rules. Veil lets you check. The site registers its rules on NEAR, the chat widget refuses to run unless the live rules match, and every answer can carry a receipt.</p>
        <div className="vgrid">
          <ol className="flow">
            <li><b>Publish.</b> The site writes its AI's instructions and hard rules, such as “at most 80 words”, “always say it is an AI”, “never output a social security number”. A fingerprint of them goes on NEAR with a version and a date. Each site can also give its assistant its own documents: their fingerprint is registered too, so a tampered copy is refused. The rules themselves stay readable by anyone.</li>
            <li><b>Match.</b> The widget on the site compares the rules it is about to use with the registered fingerprint. Change a single word without re-registering and the chat switches itself off.</li>
            <li><b>Enforce.</b> Every reply is checked against the rules before you see it. A reply that breaks one is withheld and replaced with a safe fallback.</li>
            <li><b>Prove.</b> Ask for a receipt: a signed record that this exact answer came from the verified enclave under the registered rules. Anyone can check it, without trusting the site or us.</li>
          </ol>
          <figure className="wmock" aria-label="Illustration of the chat widget on a law firm's site">
            <div className="wm-head"><b>Harbor &amp; Finch LLP</b><span>Private AI · policy v2 registered on NEAR</span></div>
            <div className="wm-body">
              <div className="wm-msg bot">Hello. I'm an AI assistant for Harbor &amp; Finch. I can't give legal advice.</div>
              <div className="wm-msg me">Can I sue my landlord over my deposit?</div>
              <div className="wm-msg bot">I'm an AI, so I can't say. Deposit disputes depend on your lease and local law. An attorney can review it: would you like to book a consultation?</div>
            </div>
            <ul className="wm-rules" aria-label="Rules checked on every reply">
              <li>at most 80 words</li><li>mentions “AI”</li><li>never says “guarantee”</li><li>contains no social security number</li>
            </ul>
            <figcaption>The widget on a fictional law firm's page. An illustration: the real one runs in the demo below.</figcaption>
          </figure>
        </div>
        <div className="verdicts">
          <div><h3>Authentic</h3><p>This exchange really went through the attested NEAR AI enclave, and nobody edited it afterwards.</p></div>
          <div><h3>Obeyed the rules</h3><p>Every rule a program can check held on this exact reply. A reply that broke one still gets a receipt that shows it, so a site cannot hide a violation.</p></div>
          <div className="not"><h3>Rules a program can check</h3><p>Word limits, required and forbidden text, no card or ID numbers: checked on every reply. Judgement calls such as tone stay with the model, and the receipt shows the instruction that was sent.</p></div>
        </div>
        <div className="hero-cta">
          <a className="btn btn-solid" href={WIDGET_DEMO}>Try the widget on the demo site</a>
          <a className="btn btn-line" href="#/app">Verify a receipt in the app</a>
        </div>
        <p className="fine">The demo site runs locally: start it with <span className="mono">npm run widget:relay</span> and <span className="mono">npm run widget:demo</span> (see the README).</p>
      </section>

      <section className="how" id="compare">
        <h2>Private AI, compared</h2>
        <p className="sec-lede">Most chat apps ask you to take their word. Here is what you can check yourself.</p>
        <div className="tablewrap">
          <table>
            <thead><tr><th scope="col"></th><th scope="col">Typical AI chat</th><th scope="col">"Private" AI chat</th><th scope="col">Veil</th></tr></thead>
            <tbody>
              <tr><th scope="row">Messages encrypted to a key you verified</th><td>No</td><td>Their word</td><td className="plain">Yes, attestation checked in your browser</td></tr>
              <tr><th scope="row">The rules its AI follows are public and fixed</th><td>No</td><td>No</td><td className="plain">Registered on NEAR, enforced on every reply</td></tr>
              <tr><th scope="row">Proof an answer came from the enclave</th><td>No</td><td>No</td><td className="plain">Signed receipt, opt in</td></tr>
              <tr><th scope="row">Use of your saved chats</th><td>All-or-nothing, often for training</td><td>Off, no record</td><td className="plain">Per session, expires, revoked on the next answer</td></tr>
              <tr><th scope="row">Add a private AI to your own site</th><td>Build it yourself</td><td>Rarely</td><td className="plain">One script tag, with its own knowledge base</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="memory" id="memory">
        <h2>Consent that works on the next answer</h2>
        <p className="sec-lede">A model owner can answer questions using chats people chose to share. Each question re-checks consent on NEAR, decrypts only what is shared right now, uses only the relevant sessions, and lists them as sources. Nothing is trained, so there is nothing to un-train.</p>
        <div className="three">
          <div><h3>Mute, revoke or forget</h3><p>The session is gone from the very next answer. There is no waiting for a training run, and no model weights that kept it.</p></div>
          <div><h3>Sources, not guesses</h3><p>Every answer says which sessions it used. The owner can anchor that use on NEAR, and each contributor can verify their session was one of them.</p></div>
          <div><h3>Sharing means sharing</h3><p>The model owner reads what you share, for as long as you allow. Revoking ends all future use, and the record of past rounds stays on NEAR.</p></div>
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
            <h3>What stays with the company</h3>
            <p>Once Ledgerline decrypts a shared session it handles that plaintext under its own controls. Revoking removes a session from the next answer and the next round, and nothing is trained, so there are no weights to un-train. Production adds mainnet, managed key storage and a legal review of the consent wording.</p>
          </div>
        </div>
      </section>

      <section className="how" id="faq">
        <h2>Questions</h2>
        <div className="faq">
          <details><summary>Can the website or Veil read my messages?</summary><p>No. Your browser encrypts each message to a key it has first verified belongs to an attested enclave (Intel TDX and NVIDIA GPUs). The site's relay only forwards ciphertext, and refuses anything that isn't encrypted.</p></details>
          <details><summary>How do I know a site's AI follows its rules?</summary><p>The site registers a fingerprint of its rules on NEAR. The widget switches itself off if the live rules don't match, withholds any reply that breaks a rule, and can give you a signed receipt for any answer that you verify yourself.</p></details>
          <details><summary>Is my data used to train a model?</summary><p>Never. Nothing is trained or fine-tuned. If you share a session, a model owner can use it as context for answers, only while your consent is live, and you can revoke it any time.</p></details>
          <details><summary>Can a site keep documents private?</summary><p>Yes. A workspace can hold public documents anyone can verify, search them semantically inside a TEE, or seal them so only the enclave reads them.</p></details>
          <details><summary>What do I have to trust?</summary><p>The chip makers' attestation, NEAR AI Cloud's published enclave images, and the site owner for the relay that holds the API key. Everything else has a check you can run. This build runs on NEAR testnet, and the built-in wallet is for demos, not real funds.</p></details>
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
          <li>Or open the demo law-firm site, chat with its widget, save a receipt, and verify it in the app's Receipts tab.</li>
        </ol>
        <div className="hero-cta">
          <a className="btn btn-solid" href="#/app">Open the app</a>
          <a className="btn btn-line" href={`${EXPLORER}/accounts/${CONTRACT}`} target="_blank" rel="noreferrer">View the contract on testnet</a>
        </div>
      </section>

      <footer className="lp-foot">
        <span>Veil. The concept comes from an earlier project; this is a new codebase built on NEAR during the hackathon.</span>
        <span className="mono">{CONTRACT}</span>
      </footer>
    </div>
  );
}
