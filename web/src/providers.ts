import { OpenAICompatProvider, MockProvider, NearAIProvider, type ChatProvider } from "@client/provider";
import { NearAI } from "@client/nearai";
import { OLLAMA_URL } from "./config";
import { getNearKey, getNearModel } from "./nearKey";
import { verifyFull } from "./verifier";
export const PROVIDERS: Record<string, { make: () => ChatProvider; model: string }> = {
  ollama: { make: () => new OpenAICompatProvider("Ollama (local, dev)", OLLAMA_URL), model: import.meta.env.VITE_OLLAMA_MODEL ?? "gemma2:2b" },
  mock: { make: () => new MockProvider(), model: "mock" },
  "near-ai": { make: () => { if (!getNearKey()) throw new Error("Enter your NEAR AI API key in the attestation panel first."); return new NearAIProvider(new NearAI(getNearKey()), verifyFull); }, get model() { return getNearModel(); } },
};
