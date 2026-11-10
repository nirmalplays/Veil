# Veil

Private AI chat where each session is encrypted in the browser, and a model owner can use it (as scored data and as retrieval context for answers) only while the user's consent is live. Sites can publish the rules their AI follows, and every answer can come with a signed receipt. Consent, scores, rounds and policies are recorded on NEAR. Nothing is trained or fine-tuned. Built for NEAR HACKATHON, track **Privacy & Private AI**.

## Problem
People chat with AI models about sensitive work. The platform sees every prompt, model builders can only get that data on trust, and "private AI" claims are rarely checkable. Veil keeps sessions unreadable to the operator, lets the user decide per session who may use it, and makes the rest checkable.

## What it does
1. **Chat in a TEE.** Prompts go to NEAR AI Cloud, encrypted end to end to the model's attested key. The app verifies the attestation first (see "Attestation verification").
2. **Seal.** A saved session is AES-256-GCM encrypted in the browser. Only its hash and a pointer go on-chain.
3. **Consent.** The user shares a session with one model for a period, pins it, mutes it, revokes it or forgets it. The contract enforces every state.
4. **Use.** The model owner decrypts only sessions with live consent. They can score them, and answer questions using the relevant ones as context (private retrieval). Each scored or used batch can be anchored as a Merkle-rooted round. No model weights change, so revoking, muting or forgetting a session removes it from the very next answer.
5. **Verify.** Anyone can check that a session is (or is not) a leaf of an anchored round.

## NEAR tech used
- **Smart contract (near-sdk-rs)** on testnet, [`veil-31da02.testnet`](https://explorer.testnet.near.org/accounts/veil-31da02.testnet): model registry, session commitments, consent (expiry, pin, mute, revoke, forget), eval records, per-round Merkle roots.
- **NEAR AI Cloud**: OpenAI-compatible inference in Intel TDX + NVIDIA TEEs, attestation reports, end-to-end encrypted chat (Ed25519 v2).
- **NEP-413** sign-in. Wallets: Meteor Wallet, or a built-in testnet key for demos (MyNearWallet stopped approving app connections on 2026-11-01).

## Try it (do X, see Y)
Requires Node 22. Rust 1.95 is only needed to run the contract tests (pinned in `contract/rust-toolchain.toml`).

### A. No accounts, no credits, no model (about 5 minutes)
```
npm run setup        # installs client and web
npm run demo         # starts the local blob store and the app together
```
1. Open http://localhost:5173/#/app and click **Create inline wallet**. See a `veil-xxxxxxxx.testnet` account, funded by the testnet faucet.
2. Click **Sign in with NEP-413**. See "Signed in with NEP-413".
3. In Chat, **Load a fictional sample** (for example "Refactor nested loops"), then **Encrypt, upload and commit on NEAR**. See the session under **My sessions** with "committed on-chain". Load and save "Reconcile fails on partial refunds" too.
4. In **Model owner**, enter a model id, **Look up**, **Register**. See "you own this".
5. In **My sessions**, set the same model id, **Share for 7 days** on the refactor session only. See "Shared until …".
6. In **Model owner**, set "Score with" to `mock`, then **Load consented sessions and score**. See one session, not two. Then **Record scores and anchor round**.
7. In **Verify inclusion**, **Reload rounds**, pick the round and each session. See "verified" for the shared one and "not in this round" for the private one.
8. Back in **My sessions**, try **Mute**, **Pin**, **Revoke**, then **Forget** on a session. See "What remains after forgetting".

The `mock` scorer returns a stable number from the text. It is not a model. Samples are in `samples/sessions.json` and are entirely fictional.

### B. With a NEAR AI Cloud key (real enclave)
1. Create a key at https://cloud.near.ai. A few cents of credit is enough; the app caps replies at 700 tokens and defaults to the cheapest attested model, `z-ai/glm-5.3-flash`.
2. In Chat, open **NEAR AI attestation**, paste the key (kept in memory only, never stored), click **Fetch and verify**. See every check listed, ending in "Verified: genuine TDX hardware and NVIDIA GPUs".
3. Pick `near-ai` in the provider list. See the "TEE + E2EE" badge. Send a message; the reply is decrypted in the browser. In **Model owner**, scoring can use `near-ai` too, and the attestation hash anchored on-chain is the real report's hash.

### C. Verify an attestation from the command line
```
cd client && npm install
NEARAI_API_KEY=... npm run verify            # uses no credits
```
See PASS/FAIL per check and "VERIFIED. Pin this model key: …".

### D. Storage through the blob gate (Supabase, or its local stand-in)
By default the app uses a local dev blob store with no access control. With `VITE_SUPABASE_URL` set (setup in `supabase/README.md`) it uses a private Supabase bucket that only the `blob-gate` Edge Function can reach. The gate signs people in by NEP-413 and asks the NEAR contract who may read what: you read your own blobs, and a model owner reads a session only while consent for their model is live. Mute, expiry, revoke and forget cut access at once.
```
cd web
npm run gate                                    # terminal 1: the same gate logic over a local disk store, port 8788
VITE_GATE_URL=http://localhost:8788 npm run dev # terminal 2
```
Use two inline wallets in two browser profiles, one as the user and one as the model owner. The owner sees nothing until the user shares, loses access when the user mutes, and the blob is gone after Forget.

### E. Tests
- `npm run test:contract` (or `cd contract && cargo test`) gives **29 passed**: consent lifecycle, expiry, pin / mute / forget, owner-only access, score bounds.
- `npm test` at the repo root runs the client tests and both typechecks. The client suite gives **47 passed**: crypto, key wrapping, E2EE, Merkle proofs, consent states, forget residue, attestation verification (with tamper cases) on a captured real report, and the blob gate and NVIDIA forwarder (sign-in including a signature made by `near-api-js`, per-account prefixes, consent-gated reads, own-prefix deletes, manifest roots).

## What is stored where
The app has no backend of its own that sees prompts or replies. Nothing is kept by us after a response returns: an unsaved chat exists only in the browser tab and is gone on reload.

| Place | What it holds | Can read your chat? |
|---|---|---|
| Browser tab memory | The conversation in progress, your NEAR AI key | You |
| Browser localStorage | Keys for sessions you saved, the testnet inline wallet key, a model owner's decryption key (dev build) | You |
| Blob store: Supabase Storage behind the `blob-gate` Edge Function (or the local dev store) | AES-256-GCM ciphertext of sessions you chose to save, and public round manifests (lists of session hashes) | No. It never gets a key. Forget deletes the blob. |
| NEAR contract (public) | Session hashes and blob pointers, consent records with expiry and wrapped keys, scores, attestation hashes, Merkle roots | No. Hashes and keys only. |
| NEAR AI Cloud | Receives prompts encrypted to the attested enclave key and returns replies encrypted to an ephemeral browser key | Only the verified enclave. Their own retention policy is theirs; we claim no more than E2EE plus TEE. |
| NVIDIA forwarder (the `blob-gate` function when deployed, else the Vite dev server's `/nras` proxy) | Forwards NVIDIA's public attestation evidence, which carries a nonce and no user data, to one fixed NVIDIA URL. Stateless, and it cannot forge a verdict. | No |

A model owner can read a session only after the user grants consent, and keeps a copy once decrypted (see "Limits").

## Attestation verification
`client/src/verify.ts` follows the NEAR AI verification guide. For a fresh nonce it checks:
1. The report lists model attestations and echoes our nonce (no replay).
2. **Intel TDX quote**: signature chain and TCB status verified against Intel collateral (via `@phala/dcap-qvl` and Phala's PCCS). Accepted statuses: `UpToDate`, `SWHardeningNeeded`.
3. The enclave is not in debug mode.
4. **REPORT_DATA** taken from the verified quote equals the model's signing key followed by our nonce.
5. The **event log replays to the quote's RTMR3**, and the **docker compose hashes to the quote's MRCONFIGID**.
6. **NVIDIA GPUs**: the evidence goes to NVIDIA's attestation service; the overall verdict must be true, the nonce must match, and the signed token is checked against NVIDIA's published keys.

NVIDIA's service refuses browser requests, so the evidence is posted through a forwarder: the `blob-gate` function in a hosted build, or the dev server's `/nras` proxy locally. The forwarder cannot change the outcome, because the signed token is checked in the browser against NVIDIA's own keys, fetched directly. It accepts GPU evidence only, to one fixed URL, with a 2 MB cap.

Only after all of this does the app pin the model key and encrypt to it.

Not checked: the enclave's TLS binding to the gateway; whether the measured app version is on an approved list (we confirm the hardware and that the app it measured is the one served, not that the app is trustworthy); Sigstore provenance; NVIDIA's per-GPU tokens beyond the overall verdict. The contract anchors a hash of the report. It does not verify attestations on-chain.

## Answer receipts and the policy registry
A receipt lets someone who was not in the conversation check that an answer really came from an attested NEAR AI enclave, and which policy (master prompt plus guardrails) it was given.

- **What the enclave signs.** NEAR AI signs `model:sha256(request body):sha256(response body)` with an ed25519 key, readable at `/v1/signature/<id>`. It works with E2EE on: the hashes cover the encrypted bytes. That key is the same one the TDX quote binds, which `verifyReceipt` checks.
- **What a receipt holds.** The exact request and response bodies, the signature, the attestation report and nonce, and the hash of the policy (prompt and rules). It can optionally disclose the prompt and reply together with the ephemeral keys, so a verifier can decrypt them and confirm they match the signed bytes. A proof-only copy omits those keys and reveals nothing.
- **Policy registry.** `publish_policy(site_id, policy_hash, uri)` on the contract. Only the site owner can add versions, old versions stay, and `policy_at(site_id, ms)` returns the policy in force at a given time. Only the hash is stored.
- **In the app.** Chat has a Policy box: it is sent as the system message, and you can publish its hash. Receipts are opt-in: tick "Allow receipts for this chat", then press "Get receipt" on the answers you want. They go into a receipt log (in memory only) where you can check each one fully and save it as proof-only or with content. Unticking wipes what was kept. The Receipts tab verifies a saved file, with the full Intel TDX and NVIDIA check if you leave it on, and compares the policy with the registry.
- **Command line.** `NEARAI_API_KEY=… npx tsx client/scripts/make-receipt.ts out.json` runs one real completion and verifies the receipt it writes. A captured one is in `client/test/fixtures/receipt.json`, and the tamper tests are in `client/test/receipt.test.ts`.

**Rules a program can check.** A policy is the prompt plus mechanical rules: a word limit, text that must or must not appear, a pattern that must not match (for example a social security number). The registered hash covers both. With a receipt that discloses its content, a verifier decrypts the reply from the signed response and re-runs every rule on it. The result is two separate verdicts: *authentic* (this exchange really went through the enclave) and *obeyed the rules* (every checkable rule held), and the second is only meaningful when the policy hash matches the one registered on NEAR. The widget enforces the same rules: a reply that breaks one is withheld, and its receipt still proves the violation, so a site cannot hide it.

What it does not prove: rules cannot express tone or judgement, so a prompt line such as "never give legal advice" is not proven to have been obeyed, only that it was sent. A site can also register a policy and never use it, which a receipt without the matching hash would reveal. Compliance is only checked on receipts that disclose their content.

## Private retrieval
This is what "using" a shared session means here. In the Model owner tab, **Answer with consented memory** re-checks consent on NEAR for every question, decrypts only the sessions shared with that model right now, ranks them against the question in the browser (BM25 keyword scoring, with a relevance cutoff so an unrelated session is never sent), and sends the best few as context inside an end-to-end encrypted request. It lists the sources it used and can anchor that use as a round, so each user can verify their session was one of them.

Nothing is trained, so there is no lag: muting, revoking or forgetting a session removes it from the very next answer. `client/scripts/memory-demo.ts` shows it against the real enclave: asked about a pipeline timeout, the model gives generic advice without memory, and with one consented session it names the exact setting from that session.

What it does not do: the model owner sees the plaintext of what is shared with them (that is the consent), retrieval is keyword-based rather than semantic, and the context is sent to the enclave, not kept private from the model.

## Embeddable widget
`widget/` is a private AI chat any site can paste in, with a master prompt and guardrails set by the site. Before a visitor can type, the widget checks that the site's policy matches the hash registered on NEAR, and otherwise switches itself off. Messages are encrypted in the visitor's browser to the attested enclave, so the site's relay (which holds the API key) sees only ciphertext. A demo law-firm site is included: see [widget/README.md](widget/README.md). Run it with `npm run widget:relay` and `npm run widget:demo`.

## Consent controls
Three controls per session, all owned by the session's owner. Only the owner can use them.

| Control | On-chain | Off-chain |
|---|---|---|
| **Pin** (`pin_consent`) | Removes the expiry on an existing consent, so it stays live until revoked or forgotten. `grant_consent` with no expiry does the same. | Nothing. |
| **Mute** (`pause_consent` / `resume_consent`) | Pauses the consent without losing the grant or its expiry. While muted, `has_consent` is false, `record_eval` is refused, and the session is left out of `consented_sessions` and the owner's view of the consent. Resuming restores it and never extends the expiry. | Nothing. The model owner already holds any plaintext they decrypted earlier. |
| **Forget** (`forget_session`) | Marks the session forgotten. From then on `has_consent` is always false, `grant_consent`, pin, mute and resume are refused, and the session never appears in `consented_sessions`. Emits an `EVENT_JSON` log (`session_forgotten`, with the blob pointer) so the client knows to delete the blob. `revoke_consent` still works, to remove a leftover grant. | The client deletes our copy of the encrypted blob when it sees the event. Whether the bytes are truly erased depends on the storage backend. The dev blob store deletes them; the production store (Supabase) is not wired yet. |

`revoke_consent` remains the way to remove a grant outright.

What these controls cannot do: forgetting or muting stops future use only. A round that already scored or used the session stays on-chain as a record, and a model owner who already decrypted the session keeps what they read. Because nothing is trained, a muted, revoked or forgotten session is excluded from the next retrieval answer. Wrapped keys written before a revoke or forget also remain in chain history.

The helper `consentState()` in `client/src/consent.ts` turns a consent record into `active`, `pinned`, `muted`, `expired` or `none` for the UI.

In the web app, each session card has Share, Pin, Mute/Unmute, Revoke and Forget. Forget asks for confirmation, calls `forget_session`, deletes our copy of the encrypted blob and then shows **What remains after forgetting**, built by `forgetResidue()`: which rounds already included the session, any recorded score, the wrapped key still in chain history, whether the blob is really gone (checked by fetching it), and the one thing that can't be measured, a model owner's own copy. In this build the blob store is a local dev server that supports delete.

## Limits
- Revoke, mute and forget stop future use only. A round that already used a session stays on-chain as a record, and a model owner who already decrypted a session keeps what they read.
- Storage is centralised. It holds only ciphertext, but it can go down or lose a blob. That is not a NEAR guarantee. The Supabase path is built and its gate logic is tested against a local stand-in; it has not been run against a live Supabase project yet.
- No zero-knowledge proofs, and no claim of "zero data leakage".
- Testnet only. The inline wallet keeps a throwaway key in localStorage. Do not use it for real funds.
- The scorer is a relevance rating by a model (or the mock). It is not a measure of data quality. No model is trained or fine-tuned anywhere in this project (NEAR AI Cloud has no fine-tuning API); "using" a session means retrieval, and retrieval is keyword-based (BM25), not semantic.
- Consent wording is not legal advice.

## Libraries and AI assistance
The code was written with AI assistance (Claude Code) and reviewed and tested by the author. Libraries: `near-sdk` (Rust); `near-api-js`, `@near-wallet-selector/*`, `@noble/curves`, `@noble/hashes`, `@noble/ciphers`, `@phala/dcap-qvl`, `buffer`, React and Vite (TypeScript). The consent model, contract, client and web app are original to this repository. Models used for demos: a local Ollama `gemma2:2b` stand-in and NEAR AI Cloud's `z-ai/glm-5.3-flash`.

## Prior work disclosure
The concept (encrypted sessions, relevance scoring, opt-in data sharing, on-chain registry) comes from an earlier project I contributed to. This repo is a new codebase started during the hackathon window; no code was copied. Differences: a NEAR contract instead of Solidity, consent with expiry, pin, mute and forget, TEE inference with attestation verification instead of sending summaries to a third-party API, Merkle commitments for training rounds, and no Chainlink dependency.

## Layout
- `contract/` Rust NEAR contract and its tests
- `client/` TypeScript: AES-GCM, key wrapping, E2EE, Merkle proofs, attestation verification, NEAR AI client, `npm run verify`
- `web/` React app (Vite), including the landing page, a local blob store and a local blob gate
- `widget/` embeddable chat widget, its relay and a demo law-firm site
- `supabase/` the `blob-gate` Edge Function, its bucket migration and setup notes
- `samples/` fictional sample sessions
- `docs/PRD.md` product requirements and decisions

## License
MIT, see `LICENSE`.
