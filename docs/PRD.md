# PRD — Veil

Owner: SI · Track: Privacy & Private AI (optional: Agent Economy) · Deadline: Nov 14, 2026 23:59 UTC · Status: draft v1 (Nov 2)

## 1. One-liner
Private AI chat where your sessions are encrypted on your device, and model owners can use them (scored, and as retrieval context) only with your revocable, expiring consent; sites can publish checkable rules for their AI and prove each answer with a signed receipt, with the proof anchored on NEAR.

## 2. Problem
- Chat platforms see all session content. Users can't control or audit who uses it.
- Model builders need real-world data but can't get it without taking it on trust or scraping.
- Existing "private AI" claims are unverifiable marketing.

## 3. Users
| User | Need |
|---|---|
| Chatter | Use a capable model on sensitive work without the operator reading it; choose who may use a session; revoke. |
| Model owner | Get consented, relevance-scored context; prove which sessions were scored or used in an answer. |
| Judge/auditor | Verify claims end to end with a clear "do X, see Y". |

## 4. Goals (must ship by Nov 14)
1. Wallet login (NEP-413), chat via NEAR AI Cloud, attestation report shown and checked.
2. Sessions encrypted client-side; hash committed on NEAR testnet.
3. Per-session, per-model consent: grant, expiry, revoke, enforced by the contract.
4. Consented sessions scored inside a TEE; score + attestation hash recorded on-chain.
5. Per-round Merkle root of session hashes anchored; user can verify their session's inclusion.
6. Public repo, README with threat model and "do X, see Y", 90s demo on X.

## 5. Non-goals
- Zero-knowledge proofs or "zero data leakage" claims.
- On-chain TEE attestation verification (done off-chain; hash anchored).
- Custom fine-tuning inside a TEE unless a supported path is confirmed (see 9).
- Mainnet, tokens, multi-chain.

## 6. Functional requirements
| ID | Requirement | Status |
|---|---|---|
| F1 | Contract: register_model (+enc_pubkey), commit_session, grant_consent (+wrapped_key, optional expiry), pin / pause / resume / revoke consent, forget_session, record_eval, record_round, views | ✅ done, 29 tests; redeployed as `veil-31da02.testnet` |
| F2 | Client: AES-256-GCM with account-bound AAD, session hash, Merkle + proofs; 🚧 add X25519 key wrap and HTTP blob client | ✅ done; key wrap and `consentState` added, 47 client tests |
| F3 | Client: NEAR AI Cloud chat, attestation, signature wrappers | ✅ ed25519 E2EE chat verified live on `z-ai/glm-5.3-flash`; full attestation verification: Intel TDX quote, REPORT_DATA binding, RTMR3 replay, compose hash, NVIDIA GPUs (live and unit-tested). Not done: gateway TLS binding, approved-measurement list |
| F4 | Web: NEP-413 login, chat UI, attestation panel (nonce, report hash, verify result) | ✅ built, incl. attestation panel (checks key-to-quote binding against the live API); 🚧 real-wallet flow untested (Meteor blocks automation); full UI flow verified with a dev key signer |
| F5 | Web: encrypt → store blob → commit_session; session list with per-session controls: share (expiry or pin), mute / unmute, forget | ✅ built: Share / Pin / Mute / Revoke / Forget on each session, with a residue report after Forget; verified on testnet; storage through the blob gate |
| F6 | Model-owner view: consented sessions, run scoring, record_eval, record_round | ✅ built, scoring on Ollama (not TEE); logic verified on testnet |
| F7 | Inclusion check: user pastes round root, UI verifies Merkle proof for own session | ✅ built; logic verified on testnet |
| F8 | Testnet deploy, addresses in README | ✅ `veil-31da02.testnet` (earlier deploys with older state layouts are retired) |
| F9 | Optional: stablecoin payout to consenting users via NEAR Intents | not built; only if time allows |
| F10 | Private retrieval: rank consented sessions in the browser (BM25), send the relevant ones as encrypted context, show sources, anchor the use as a round | ✅ built; consent re-checked per question; browser test shows mute and revoke drop a session from the next answer |
| F11 | Answer receipts: enclave signature over the exact request and response bodies, bound to the attested key, optional disclosure | ✅ built; verified in browser with full TDX and GPU attestation |
| F12 | Policy registry (`publish_policy`, `policy_at`) with a machine-checkable policy (prompt plus rules); a receipt re-runs the rules on the disclosed reply | ✅ built; authentic and compliant are separate verdicts |
| F16 | Sealed knowledge base: relay seals it to a self-verified enclave key, the browser forwards ciphertext, the model reads it whole inside the TEE; owner audit proves what was sealed against the registered root | ✅ built; 15-check real-enclave browser test incl. attacker-key refusal |
| F15 | Semantic retrieval in a TEE: passages and questions embedded by `Qwen3-Embedding-0.6B` in an attested enclave over E2EE, vectors covered by the Merkle root, cosine ranking in the browser, keyword fallback | ✅ built; real-enclave browser test with a paraphrased question |
| F14 | Per-workspace knowledge base: passages hashed into a Merkle root inside the registered policy, retrieval in the visitor's browser, source citations, and receipts that prove the used passages belong to the registered root | ✅ built; two-workspace browser test on the real enclave |
| F13 | Embeddable widget, relay and demo law-firm site | ✅ built; blocks itself if the policy does not match the registry; withholds replies that break a rule |

## 7. Key flows
1. **Chat:** login → pick model → send → response + signature id → attestation fetched with fresh nonce and shown.
2. **Save & share:** encrypt → blob stored → `commit_session(hash, blob_id)` → share with model M → `grant_consent` with an expiry, or pinned with none.
3. **Use:** owner calls `consented_sessions(M)` → decrypts only keys shared by users → either TEE scoring (`record_eval`) or retrieval for an answer (top relevant sessions as encrypted context) → `record_round(root)`. Nothing is trained.
4. **Control:** **mute** (`pause_consent`) stops use now and keeps the grant; **resume** restores it; **pin** removes the expiry; **revoke** removes the grant; **forget** (`forget_session`) ends all use of the session for good and signals the client to delete the encrypted blob. Muted, revoked, expired and forgotten sessions have `has_consent` false and are left out of the next round.

## 8. Threat model (summary; full table in README)
Chain and operator see hashes only. Model owner sees only consented sessions. Attestation is verified off-chain. Residual risks: key-sharing step is a trust point (owner holds plaintext after consent); blob store availability is not a NEAR guarantee; revoke, mute and forget stop future use only and cannot undo past rounds. Forget also can't delete copies a model owner already decrypted, and deleting our copy of the encrypted blob depends on the storage backend (not chosen yet). Wrapped keys stay in chain history.

## 9. Decisions
Settled Nov 3. Fine-tune vs retrieval and the Agent Economy track are still open.

| Decision | Choice | Why / consequences |
|---|---|---|
| Blob storage | **Supabase Storage** (private `blobs` bucket, public `rounds` bucket) behind a `blob-gate` Edge Function. Only AES-GCM ciphertext is uploaded. `blob_id` is opaque (`sb:<account>/<id>`). | The gate signs people in with NEP-413 and lets the NEAR contract decide access: owners read their own blobs, a model owner reads a session only while consent for their model is live. Built and unit-tested; run end to end against a local stand-in with two accounts. Not yet run against a live Supabase project. It is centralised, so the README says availability is not a NEAR guarantee. |
| NEAR AI E2E mode | **Use it** (documented: docs.near.ai/cloud/guides/e2ee-chat-completions). Ed25519 v2: X25519 ECDH, HKDF-SHA256, XChaCha20-Poly1305. Headers `X-Signing-Algo`, `X-Client-Pub-Key`, `X-Model-Pub-Key`, `X-Encryption-Version: 2`, `x-no-aliasing: true`. The model key comes from a verified attestation report (`signing_public_key`), never a raw candidate. | `client/src/nearai.ts` still defaults to ecdsa, so switch it to ed25519 and add E2EE request/response helpers (needs @noble/ciphers and @noble/curves, since WebCrypto has no XChaCha20). v1 is non-streaming. **Spike by end of Nov 4**: if one E2EE call isn't working, ship a TEE-only claim and say so in the README. |
| Key sharing for consent | **Wrap the session key to the owner's X25519 key** (ephemeral X25519, HKDF, AES-GCM, ECIES-style). Not in-TEE key release. | Simple and auditable. Contract changes: `register_model` takes `enc_pubkey`, and `grant_consent` takes `wrapped_key`. The wrapped key lives in contract state, so owner flow F6 is `consented_sessions` → wrapped key → blob → decrypt, with no off-chain channel. Revoke deletes it from state, but chain history keeps it, so the README says revoke stops future rounds and can't claw back plaintext. In-TEE release is listed as future work. |
| Fine-tune vs retrieval | **Private retrieval and scoring. No fine-tuning.** Decided Nov 3. | Fine-tuning has no confirmed TEE path. The model owner scores consented sessions for relevance to the model's tags and records the score on-chain. The consented sessions then form a retrieval corpus. Scoring runs on a local Ollama model (`gemma2:2b`) while NEAR AI credits are pending. It is labeled **not TEE, no attestation** until it moves to NEAR AI. |
| Build order | **Ollama first, NEAR AI E2EE last.** | The whole loop (chat, commit, consent, score, round, inclusion) is built against `OpenAICompatProvider` so nothing blocks on credits. Moving to NEAR AI means swapping in `NearAIProvider` and recording the real attestation hash. The `private` flag keeps the UI honest in the meantime. |
| Agent Economy second track | Open (due Day 10). Only with a real payout flow. | |

## 10. Success metrics
- A judge completes the README demo in under 5 minutes with no setup beyond a wallet.
- ≥1 full loop on testnet: chat → commit → consent → eval recorded → round anchored → inclusion verified → revoke.
- Contract + client tests green in CI; every README claim maps to code.
- Demo video shows live testnet tx links.

## 11. Risks
| Risk | Mitigation |
|---|---|
| Prior-work eligibility challenge (an earlier related project) | New codebase, explicit disclosure in the README, no copied code |
| NEAR AI endpoints/models differ from assumptions | Verify against docs.near.ai on day 2; keep wrapper thin |
| Overclaiming privacy | Threat-model table; no ZK wording |
| Fine-tune not feasible in TEE | Decided: retrieval. NEAR AI Cloud has no fine-tuning API, and retrieval makes revocation take effect on the next answer. |
| Time (12 days, solo) | Cut order: F9 → F7 → F6 polish; never cut F1–F5, F8 |

## 12. Timeline
- Nov 2–3: contract/client done; testnet deploy; NEAR AI key + verify endpoints; login.
- Nov 4–6: chat + attestation UI; encrypted commit; consent UI; fine-tune/retrieval decision.
- Nov 7–9: TEE scoring, record_eval, Merkle rounds.
- Nov 10–11: owner view, inclusion check, optional payout.
- Nov 12–13: README polish, demo video, X post.
- Nov 14: buffer; submit before 23:59 UTC (form can't be edited after sending).

## 13. Submission checklist
Public repo · README (problem, how it works, run steps, NEAR tech named, prior-work disclosure, do-X-see-Y) · X demo post mentioning NEAR HACKATHON · form: name, 20–2000 char description, lead/email/team size, track, payout NEAR account, links.
