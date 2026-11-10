import { verifyModelAttestation, type FullVerification } from "@client/verify";
import { GATE_URL } from "./config";

/**
 * Full verification (Intel TDX quote, event log, compose hash, NVIDIA GPUs). NVIDIA refuses browser CORS preflights, so its POST
 * goes through a forwarder: the blob-gate function when one is configured (hosted builds), else the Vite dev server's /nras proxy.
 * Either way the forwarder cannot forge a verdict: the signed token is checked here against NVIDIA's own keys.
 */
export const verifyFull = (report: unknown, nonce: string): Promise<FullVerification> =>
  verifyModelAttestation(report, nonce, { nrasProxy: GATE_URL ? `${GATE_URL}/nras` : "/nras" });
