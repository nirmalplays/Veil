import { useEffect, useState } from "react";
import { activateInline, consumeRedirect, createInline, currentAccount, hasInline, inlineAccountId, inlineActive, loginChallenge, openModal, signOut, type Proof } from "./wallet";
import { Badge, ContractLink, errMsg, short } from "./ui";
import { Chat } from "./Chat";
import { Sessions } from "./Sessions";
import { Owner } from "./Owner";
import { Verify } from "./Verify";
import { Receipts } from "./Receipts";

type Tab = "chat" | "sessions" | "owner" | "verify" | "receipts";

export function App() {
  const [account, setAccount] = useState<string>();
  const [proof, setProof] = useState<Proof>();
  const [tab, setTab] = useState<Tab>("chat");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await consumeRedirect();
        if (p) setProof(p);
        setAccount(await currentAccount());
      } catch (e) { setErr(errMsg(e)); }
    })();
  }, []);

  const makeInline = async () => {
    setErr(""); setBusy(true);
    try { await createInline(); setAccount(await currentAccount()); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const useInline = async () => { activateInline(); setAccount(await currentAccount()); };

  const login = async () => {
    setErr("");
    try {
      if (!account) { await openModal(); return; }
      const p = await loginChallenge();
      if (p) setProof(p);
    } catch (e) { setErr(errMsg(e)); }
  };

  const tabs: [Tab, string][] = [["chat", "Chat"], ["sessions", "My sessions"], ["owner", "Model owner"], ["verify", "Verify inclusion"], ["receipts", "Receipts"]];
  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#/">Veil<small>private chat, consented use</small></a>
        <div className="who">
          {account ? <span className="acct">{account}{inlineActive() && <i>inline testnet key</i>}</span> : <span className="muted">Not signed in</span>}
          {proof && <Badge kind={proof.ok ? "ok" : "bad"}>{proof.ok ? "Signed in with NEP-413" : proof.detail}</Badge>}
          {!account && (hasInline()
            ? <button className="btn-primary" onClick={useInline}>Use inline wallet ({inlineAccountId()})</button>
            : <button className="btn-primary" onClick={makeInline} disabled={busy}>{busy ? "Creating wallet…" : "Create inline wallet"}</button>)}
          <button onClick={login}>{!account ? "Connect Meteor Wallet" : proof?.ok ? "Sign in again" : "Sign in with NEP-413"}</button>
          {account && <button onClick={async () => { await signOut(); setAccount(undefined); setProof(undefined); }}>Sign out</button>}
        </div>
      </header>
      <p className="subhead">Contract <ContractLink />{proof?.ok && <> · signing key {short(proof.publicKey, 14)}</>}</p>
      {err && <div className="err">{err}</div>}
      <nav className="tabs">{tabs.map(([t, l]) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{l}</button>)}</nav>
      {tab === "chat" && <Chat account={account} />}
      {tab === "sessions" && <Sessions account={account} />}
      {tab === "owner" && <Owner account={account} />}
      {tab === "verify" && <Verify account={account} />}
      {tab === "receipts" && <Receipts />}
    </div>
  );
}
