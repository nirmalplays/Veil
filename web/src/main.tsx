import "./polyfill";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@near-wallet-selector/modal-ui/styles.css";
import "./landing.css";
import "./style.css";
import { App } from "./App";
import { Landing } from "./Landing";

// #/app (or a wallet redirect carrying #accountId=...) opens the app; anything else is the landing page.
const isApp = () => location.hash.startsWith("#/app") || location.hash.includes("accountId=");
function Root() {
  const [app, setApp] = useState(isApp());
  useEffect(() => {
    const f = () => { setApp(isApp()); if (!location.hash.startsWith("#/app")) window.scrollTo(0, 0); };
    addEventListener("hashchange", f); return () => removeEventListener("hashchange", f);
  }, []);
  return app ? <App /> : <Landing />;
}
createRoot(document.getElementById("root")!).render(<Root />);
