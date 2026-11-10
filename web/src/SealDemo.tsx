import { useEffect, useRef, useState } from "react";
import { encrypt, exportKey, generateKey, sessionHash } from "@client/crypto";
import { generateEncKeyPair, wrapSessionKey } from "@client/keywrap";

// Real client code, running in the visitor's browser. Nothing here touches the network.
const owner = generateEncKeyPair();

export function SealDemo() {
  const [text, setText] = useState("Draft the settlement terms for the Alvarez matter.");
  const [sealed, setSealed] = useState<{ ct: string; hash: string }>();
  const [consent, setConsent] = useState(false);
  const [wrapped, setWrapped] = useState("");
  const keyHex = useRef("");
  const run = useRef(0);

  useEffect(() => {
    const id = ++run.current;
    (async () => {
      const k = await generateKey();
      const s = await encrypt(k, text || " ", "demo-account.testnet");
      const hash = await sessionHash(s);
      if (id !== run.current) return;
      keyHex.current = await exportKey(k);
      setSealed({ ct: s.ciphertext, hash });
      setConsent(false); setWrapped("");
    })();
  }, [text]);

  const toggle = async () => {
    if (!sealed) return;
    if (consent) { setConsent(false); setWrapped(""); return; }
    setWrapped(await wrapSessionKey(keyHex.current, owner.publicKey, sealed.hash));
    setConsent(true);
  };

  return (
    <div className="seal" aria-label="Live demo: seal a message in your browser">
      <label className="seal-label" htmlFor="seal-in">What you typed</label>
      <textarea id="seal-in" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={240} />
      <div className="seal-row">
        <div className="seal-k">Encrypted here, in your browser</div>
        <div className="mono seal-v seal-ct">{sealed ? sealed.ct.slice(0, 96) + (sealed.ct.length > 96 ? "…" : "") : "…"}</div>
      </div>
      <div className="seal-row">
        <div className="seal-k">The only thing written to NEAR</div>
        <div className="mono seal-v seal-hash">{sealed?.hash ?? "…"}</div>
      </div>
      <div className="seal-row seal-consent">
        <button className={`switch ${consent ? "on" : ""}`} role="switch" aria-checked={consent} onClick={toggle} disabled={!sealed}>
          <span /> <b>{consent ? "Consent live for 7 days" : "Let a model owner read this"}</b>
        </button>
        <div className="seal-note">
          {consent
            ? <>Your session key, wrapped to their public key: <span className="mono">{wrapped.slice(0, 40)}…</span> They can read this session and no other. Switch off and the wrapped key is deleted.</>
            : "Off: nobody but you can read it. Not us, not the chain, not the storage."}
        </div>
      </div>
      <p className="seal-foot">Runs in your browser right now. Nothing you type here is sent anywhere.</p>
    </div>
  );
}
