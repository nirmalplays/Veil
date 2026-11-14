// Types and labels for the pipeline, with no heavy imports, so pages that only display a run stay small.
export type NodeId = "you" | "relay" | "near" | "gateway" | "enclave" | "intel" | "nvidia";
export type Kind = "step" | "ok" | "warn" | "fail" | "data" | "info";
export type StageId = "wake" | "policy" | "relay-tee" | "attest" | "verify" | "encrypt" | "send" | "decrypt" | "rules" | "receipt";

export interface FlowEvent {
  /** Milliseconds since the run started. */ t: number;
  kind: Kind; stage: StageId; actor: NodeId; text: string;
  /** The hops a request or reply travelled, in order, for the diagram. */ path?: NodeId[];
  /** Longer explanation, shown when the log line is opened. */ detail?: string;
  /** The actual bytes or values involved (hex, JSON, text). */ data?: string;
  /** Parties that could read `data`. Anyone not listed saw nothing, or only ciphertext. */ visibleTo?: NodeId[];
}

export const NODES: Record<NodeId, { label: string; sub: string }> = {
  you: { label: "Your browser", sub: "encrypts and verifies" },
  relay: { label: "Site relay", sub: "holds the API key, forwards ciphertext" },
  near: { label: "NEAR testnet", sub: "policy registry" },
  gateway: { label: "NEAR AI gateway", sub: "routes to the enclave" },
  enclave: { label: "Model enclave", sub: "Intel TDX + NVIDIA GPUs" },
  intel: { label: "Intel collateral", sub: "TDX quote verification" },
  nvidia: { label: "NVIDIA NRAS", sub: "GPU attestation" },
};

export const STAGES: { id: StageId; title: string; what: string }[] = [
  { id: "wake", title: "Reach the relay", what: "Your browser asks the site's relay for the site's public settings." },
  { id: "policy", title: "Check the rules on NEAR", what: "The rules the relay serves are fingerprinted here and compared with the fingerprint registered on NEAR." },
  { id: "relay-tee", title: "Ask the relay for proof", what: "The relay is asked to prove it runs inside a TEE. Ordinary hosting says so honestly." },
  { id: "attest", title: "Get the enclave's proof", what: "A fresh random nonce goes to the model's enclave, which returns a hardware-signed attestation that includes it." },
  { id: "verify", title: "Verify the hardware", what: "Intel and NVIDIA evidence is checked here, and the enclave's encryption key is pinned only if every check passes." },
  { id: "encrypt", title: "Encrypt in your browser", what: "Your message is encrypted to the pinned enclave key. From here on nobody else can read it." },
  { id: "send", title: "Through the relay", what: "The relay adds the API key and forwards the ciphertext. It cannot read what it carries." },
  { id: "decrypt", title: "Decrypt the answer", what: "The answer was encrypted by the enclave to a one-time key that only this browser holds." },
  { id: "rules", title: "Check the answer", what: "The answer is checked against the registered rules before it is shown." },
  { id: "receipt", title: "Signed receipt", what: "The enclave's signature over the exact bytes is fetched and verified, giving a receipt anyone can check." },
];

