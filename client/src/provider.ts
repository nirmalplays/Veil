// Chat backends behind one interface so the app can run before NEAR AI credits exist.
// Only NearAI returns an attestation; every other provider is DEV-ONLY and must be shown as "not private" in the UI.
import { NearAI, type ChatMessage, type ChatResult, type Wire } from "./nearai.js";
import type { KeyCheck } from "./e2ee.js";
import type { FullVerification } from "./verify.js";
import { makeReceipt, type Receipt } from "./receipt.js";
import type { Policy } from "./policy.js";

export interface Attestation { nonce: string; report: unknown; check: KeyCheck; full?: FullVerification }
export interface ProviderResult extends ChatResult { attestation?: Attestation; wire?: Wire }
export interface ChatProvider {
  readonly name: string;
  /** true only when requests run in an attested TEE with E2EE. */
  readonly private: boolean;
  chat(model: string, messages: ChatMessage[]): Promise<ProviderResult>;
}

export class NearAIProvider implements ChatProvider {
  readonly name = "NEAR AI Cloud (TEE, E2EE)";
  readonly private = true;
  constructor(private ai: NearAI, private verify?: (report: unknown, nonce: string) => Promise<FullVerification>) {}
  chat(model: string, messages: ChatMessage[]) { return this.ai.chatE2EE(model, messages, { maxTokens: 2500, verify: this.verify }); } // capped so a runaway reply can't burn credits; reasoning models spend much of it thinking
  /** Signed receipt for a finished chat. `disclose` adds the plaintext so a verifier can read it; leave it out to share only the proof. */
  async receipt(model: string, r: ProviderResult, opts: { policy?: Policy; disclose?: { messages: ChatMessage[] } } = {}): Promise<Receipt> {
    if (!r.wire || !r.attestation) throw new Error("this chat has no wire record");
    return makeReceipt(this.ai, model, { id: r.id, wire: r.wire, attestation: r.attestation }, { policy: opts.policy, disclose: opts.disclose && { messages: opts.disclose.messages, reply: r.text } });
  }
}

/** Any OpenAI-compatible endpoint (Ollama, OpenRouter, ...). No attestation, no E2EE: dev only. */
export class OpenAICompatProvider implements ChatProvider {
  readonly private = false;
  constructor(readonly name: string, private baseUrl: string, private apiKey = "", private f: typeof fetch = (...a) => fetch(...a)) {}
  async chat(model: string, messages: ChatMessage[]): Promise<ProviderResult> {
    const r = await this.f(this.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model, messages, stream: false }),
    });
    if (!r.ok) throw new Error(`${this.name} -> ${r.status} ${await r.text()}`);
    const j: any = await r.json();
    return { id: j.id ?? `dev-${Date.now()}`, text: j.choices?.[0]?.message?.content ?? "", raw: j };
  }
}

/** Offline canned replies: no network, for UI and flow work. Rating prompts get a deterministic 0-100 number
 *  derived from the text, so the whole consent-and-scoring loop can be tried with no model at all. It is not a model. */
export class MockProvider implements ChatProvider {
  readonly name = "Mock (offline, dev only)";
  readonly private = false;
  async chat(_model: string, messages: ChatMessage[]): Promise<ProviderResult> {
    const last = messages[messages.length - 1]?.content ?? "";
    if (/Rate from 0 to 100/.test(last)) {
      let h = 0; for (const ch of last) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return { id: `mock-${Date.now()}`, text: String(40 + (h % 56)), raw: {} };
    }
    return { id: `mock-${Date.now()}`, text: `[mock] You said: ${last}`, raw: {} };
  }
}
