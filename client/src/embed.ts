// Embeddings computed in a TEE. The embedding model is attested like the chat model, and the text to embed is encrypted to its attested key,
// so a question is embedded without anyone outside the enclave seeing it. The attested key is pinned after the first check, so later
// questions in the same session skip the slow verification (the key is what the encryption protects, and it was proven once).
import { checkModelAttestation } from "./e2ee.js";
import { EMBED_MODEL } from "./kb.js";
import type { NearAI } from "./nearai.js";
import type { FullVerification } from "./verify.js";

type Verify = (report: unknown, nonce: string) => Promise<FullVerification>;

export class Embedder {
  private key?: string;
  /** The full verification of the embedding enclave, once it has run (for display). */
  full?: FullVerification;
  constructor(private ai: NearAI, readonly model = EMBED_MODEL, private verify?: Verify) {}

  /** Fetches a fresh attestation, verifies it (fully if a verifier was given, else the key-to-quote binding), and pins the enclave's key. */
  async pin(): Promise<string> {
    const { nonce, report } = await this.ai.attestation(this.model);
    let key: string | undefined;
    if (this.verify) {
      const f = await this.verify(report, nonce);
      if (!f.ok || !f.publicKey) throw new Error(`embedding enclave attestation failed: ${f.checks.filter((c) => c.state === "failed").map((c) => c.label).join("; ")}`);
      this.full = f; key = f.publicKey;
    } else {
      const c = checkModelAttestation(report, nonce);
      if (!c.ok || !c.publicKey) throw new Error(`embedding enclave attestation failed: ${c.reasons.join(", ")}`);
      key = c.publicKey;
    }
    return (this.key = key);
  }

  /** Vectors in the same order as `texts`. Batches are small so each request stays well inside the gateway's limits. */
  async embed(texts: string[], batch = 16): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += batch) out.push(...(await this.one(texts.slice(i, i + batch))));
    return out;
  }

  private async one(texts: string[]): Promise<number[][]> {
    if (!this.key) await this.pin();
    try { return await this.ai.embedE2EE(this.model, texts, this.key!); }
    catch { this.key = undefined; await this.pin(); return this.ai.embedE2EE(this.model, texts, this.key!); }   // the enclave may have rotated its key: check again, once
  }
}
