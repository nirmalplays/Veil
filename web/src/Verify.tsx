import { useEffect, useState } from "react";
import { merkleRoot, prove, verify } from "@client/merkle";
import { view } from "./chain";
import { getManifest } from "./blobs";
import { loadSessions } from "./store";
import { Badge, errMsg, short } from "./ui";

interface Round { merkle_root: string; leaf_count: number; recorded_ms: number }

export function Verify({ account }: { account?: string }) {
  const [model, setModel] = useState("demo-model");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [root, setRoot] = useState("");
  const [hash, setHash] = useState("");
  const [out, setOut] = useState<{ kind: "ok" | "bad"; lines: string[] }>();
  const sessions = account ? loadSessions(account) : [];

  const reload = () => view<Round[]>("get_rounds", { model_id: model }).then(setRounds).catch(() => setRounds([]));
  useEffect(() => { reload(); }, [model]);

  const check = async () => {
    try {
      const m = await getManifest(root.trim());
      const lines: string[] = [];
      const recomputed = merkleRoot(m.leaves);
      const rootOk = recomputed === root.trim();
      lines.push(`Manifest has ${m.leaves.length} leaves; recomputed root ${rootOk ? "matches" : "does NOT match"} the root you pasted.`);
      const onChain = rounds.some((r) => r.merkle_root === root.trim());
      lines.push(onChain ? `This root is anchored on NEAR for model "${model}".` : `This root is NOT anchored on NEAR for model "${model}".`);
      const i = m.leaves.indexOf(hash.trim());
      let incl = false;
      if (i >= 0) { incl = verify(hash.trim(), prove(m.leaves, i), root.trim()); lines.push(`Session is leaf #${i}; Merkle proof ${incl ? "verifies" : "FAILS"}.`); }
      else lines.push("Your session hash is not in this round.");
      setOut({ kind: rootOk && onChain && incl ? "ok" : "bad", lines });
    } catch (e) { setOut({ kind: "bad", lines: [errMsg(e)] }); }
  };

  return (
    <div>
      <p className="muted">Check that a model owner's round really included your session, whether it was scored or used as context for an answer: the root is anchored on NEAR and your session hash is provably one of its leaves.</p>
      <div className="row">Model <input value={model} onChange={(e) => setModel(e.target.value)} /><button onClick={reload}>Reload rounds</button></div>
      <div className="row">Round root <select onChange={(e) => setRoot(e.target.value)} value="">
        <option value="">pick an anchored round…</option>{rounds.map((r) => <option key={r.merkle_root} value={r.merkle_root}>{short(r.merkle_root, 10)} ({r.leaf_count} sessions)</option>)}</select>
        <input style={{ flex: 1 }} placeholder="or paste a root" value={root} onChange={(e) => setRoot(e.target.value)} /></div>
      <div className="row">Your session <select onChange={(e) => setHash(e.target.value)} value="">
        <option value="">pick one of your sessions…</option>{sessions.map((s) => <option key={s.hash} value={s.hash}>{s.title}</option>)}</select>
        <input style={{ flex: 1 }} placeholder="or paste a session hash" value={hash} onChange={(e) => setHash(e.target.value)} /></div>
      <button onClick={check} disabled={!root || !hash}>Verify inclusion</button>
      {out && <div className="card"><Badge kind={out.kind}>{out.kind === "ok" ? "verified" : "not verified"}</Badge>{out.lines.map((l, i) => <div key={i}>{l}</div>)}</div>}
    </div>
  );
}
