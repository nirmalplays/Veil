import { EXPLORER, CONTRACT } from "./config";
export const Badge = ({ kind, children }: { kind: "ok" | "warn" | "bad"; children: React.ReactNode }) => <span className={`badge ${kind}`}>{children}</span>;
export const short = (s: string, n = 10) => (s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
export const ContractLink = () => <a href={`${EXPLORER}/accounts/${CONTRACT}`} target="_blank" rel="noreferrer">{CONTRACT}</a>;
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
