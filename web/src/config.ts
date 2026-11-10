export const CONTRACT = import.meta.env.VITE_CONTRACT ?? "veil-31da02.testnet";
// First healthy endpoint wins; public endpoints rate-limit (429) and a 429 carries no CORS header.
export const RPCS: string[] = (import.meta.env.VITE_RPC ?? "https://test.rpc.fastnear.com,https://rpc.testnet.near.org").split(",");
export const RPC = RPCS[0];
export const BLOB_URL = import.meta.env.VITE_BLOB_URL ?? "http://localhost:8787";
export const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? "http://localhost:11434/v1";
export const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? "gemma2:2b";
export const EXPLORER = "https://explorer.testnet.near.org";

// Blob storage. Supabase (through the blob-gate Edge Function) when VITE_SUPABASE_URL is set; any other gate (for example
// the local one, `npm run gate`) via VITE_GATE_URL; otherwise the local dev blob store. See supabase/README.md.
const SB: string | undefined = import.meta.env.VITE_SUPABASE_URL;
export const GATE_URL: string | undefined = import.meta.env.VITE_GATE_URL ?? (SB ? `${SB.replace(/\/$/, "")}/functions/v1/blob-gate` : undefined);
export const GATE_APIKEY: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;
/** Where public round manifests are read from when a gate is in use. */
export const ROUNDS_BASE = SB ? `${SB.replace(/\/$/, "")}/storage/v1/object/public/rounds` : `${import.meta.env.VITE_GATE_URL ?? ""}/public/rounds`;
