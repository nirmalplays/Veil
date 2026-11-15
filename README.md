# Veil

**AI you can check, not just trust.**

**Website:** [veil-nine-tau.vercel.app](https://veil-nine-tau.vercel.app) — try the chat, [watch a real message go through](https://veil-nine-tau.vercel.app/live) with every step logged, and read the [docs](https://veil-nine-tau.vercel.app/docs). Its source is in `site/`.

Every AI company says it protects your data. Veil lets you verify it. Your messages are encrypted in your browser to a hardware-attested enclave, the rules a business gives its AI are fingerprinted on NEAR, and every answer can come with a signed receipt anyone can check.

Built for NEAR HACKATHON, track **Privacy & Private AI**.

## Why Veil
- **Private by construction.** Prompts are end-to-end encrypted to a key the app has verified belongs to an Intel TDX + NVIDIA confidential-computing enclave. The operator, the host site and the network see ciphertext.
- **Rules that can't quietly change.** A site's prompt and checkable rules are hashed and registered on NEAR. The widget refuses to run if what is served doesn't match the registry, and withholds any reply that breaks a rule.
- **Proof for every answer.** An opt-in signed receipt shows an answer came from the attested enclave under the registered policy.
- **Your data, your call.** Share a saved session with a model for a set time, then mute, revoke or forget it. Consent is enforced by a contract. Nothing is trained: "using" a session means retrieval, so a revoked session is gone from the very next answer.
- **Your own knowledge base per workspace.** Public passages anyone can verify, semantic search in a TEE, or a sealed base only the enclave reads.
- **One script tag.** Paste a single JavaScript file into any website.

## How it works
1. **Chat in a TEE.** Prompts go to NEAR AI Cloud, encrypted end to end to the model's attested key. The app verifies the attestation first (see "Attestation verification").
2. **Seal.** A saved session is AES-256-GCM encrypted in the browser. Only its hash and a pointer go on-chain.
3. **Consent.** The user shares a session with one model for a period, pins it, mutes it, revokes it or forgets it. The contract enforces every state.
4. **Use.** The model owner decrypts only sessions with live consent. They can score them, and answer questions using the relevant ones as context (private retrieval). Each scored or used batch can be anchored as a Merkle-rooted round.
5. **Verify.** Anyone can check that a session is (or is not) a leaf of an anchored round, and that an answer's receipt matches its registered policy.

## Trust model
Veil doesn't ask you to trust it, so here is exactly what you rely on and what you can check yourself.
- **You check:** the enclave's hardware attestation (Intel TDX and every NVIDIA GPU), the registered policy hash, knowledge-base fingerprints, and each receipt's signature.
- **You rely on:** the TEE vendors' hardware, NEAR AI Cloud's published enclave images, and your own site owner for the relay that holds the API key.
- **A model owner** sees the plaintext of a session you share with them, because that is what consent means. Forgetting or muting stops future use; a round already recorded on-chain stays as a record.
- **Testnet.** The contract runs on NEAR testnet and the built-in wallet is for demos, not real funds. No zero-knowledge proofs are used, and nothing here claims "zero data leakage".
- **Consent wording** is a product feature, not legal advice.

## NEAR tech used
- **Smart contract (near-sdk-rs)** on testnet, [`veil-31da02.testnet`](https://explorer.testnet.near.org/accounts/veil-31da02.testnet): model registry, session commitments, consent (expiry, pin, mute, revoke, forget), eval records, per-round Merkle roots.
- **NEAR AI Cloud**: OpenAI-compatible inference in Intel TDX + NVIDIA TEEs, attestation reports, end-to-end encrypted chat (Ed25519 v2).
- **NEP-413** sign-in. Wallets: Meteor Wallet, or a built-in testnet key for demos (MyNearWallet stopped approving app connections on 2026-11-01).

## Start here: one completion, verified
The smallest proof, with no UI. It picks a TEE-hosted chat model from NEAR AI Cloud's models endpoint, fetches an attestation with a fresh nonce, verifies it, sends one end-to-end encrypted completion, and checks the response signature. The API key lives in `client/.env` (git-ignored; copy `client/.env.example`). A real run:
```
cd client && npm install && cp .env.example .env     # put your NEAR AI key in .env
npm run one-completion
```
```
Models endpoint: 63 models, 5 TEE-hosted chat models. Using z-ai/glm-5.3-flash.
Attestation (fresh nonce db290fa5b4addf3a…):
  PASS  Report lists model attestations
  PASS  Our fresh nonce is echoed (not a replay)
  PASS  Model key is a valid Ed25519 key
  PASS  Intel confirms the quote came from genuine TDX hardware
  PASS  Enclave is not in debug mode
  PASS  Quote binds the model key and our nonce
  PASS  Event log replays to the quote's RTMR3
  PASS  Docker compose matches the quote's MRCONFIGID
  PASS  NVIDIA confirms the GPUs are genuine and in confidential mode
  SKIP  Build provenance (Sigstore) is not verified
  PASS  Gateway: our fresh nonce is echoed (not a replay)
  PASS  Gateway: Intel confirms the quote came from genuine TDX hardware
  PASS  Gateway: enclave is not in debug mode
  PASS  Gateway: Quote binds the gateway key and our nonce
  PASS  Gateway: Event log replays to the quote's RTMR3
  PASS  Gateway: Docker compose matches the quote's MRCONFIGID
  SKIP  Gateway: Build provenance (Sigstore) is not verified
  Intel TCB status: UpToDate
Reply (encrypted to the verified key 5a0210f2442c7935…, decrypted here):
  A trusted execution environment protects the confidentiality and integrity of code and data during computation, isolating them even
  from the operating system, hypervisor, and other privileged software on the same machine.
Response signature:
  PASS  Signed model matches
  PASS  Request body matches signed hash
  PASS  Response body matches signed hash
  PASS  Enclave signature is valid
  PASS  Receipt id matches response
  PASS  Enclave attestation verified (TDX + GPU)
  PASS  Signing key is the attested enclave key
VERIFIED: the answer came from the attested enclave.
```
The script sends nothing anywhere except NEAR AI Cloud, NVIDIA's attestation service and Intel's collateral service, and writes nothing to disk. The key stays in the environment: the browser app asks for it in the page and keeps it in memory only, because a key in a browser bundle would be public.

## Try it (do X, see Y)
Requires Node 22. Rust 1.95 is only needed to run the contract tests (pinned in `contract/rust-toolchain.toml`).

### A. No accounts, no credits, no model (about 5 minutes)
```
npm run setup        # installs client, web and widget
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
1. Create a key at https://cloud.near.ai. A few cents of credit is enough; the app caps replies at 2,500 tokens (the default model is a reasoning model that spends many of them thinking) and defaults to the cheapest attested model, `z-ai/glm-5.3-flash`.
2. In Chat, open **NEAR AI attestation**, paste the key (kept in memory only, never stored), click **List TEE models** to load the TEE-hosted chat models from the models endpoint (only models NEAR AI runs itself are attested; the proxied third-party ones have no attestation), then **Fetch and verify**. See every check listed, ending in "Verified: genuine TDX hardware and NVIDIA GPUs".
3. Pick `near-ai` in the provider list. See the "TEE + E2EE" badge. Send a message; the reply is decrypted in the browser. In **Model owner**, scoring can use `near-ai` too, and the attestation hash anchored on-chain is the real report's hash.

### C. Verify an attestation from the command line
```
cd client && npm install && cp .env.example .env    # put your key in .env
npm run verify                                       # uses no credits
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
- `npm run test:contract` (or `cd contract && cargo test`) gives **32 passed**: consent lifecycle, expiry, pin / mute / forget, owner-only access, score bounds, versioned policies.
- `npm test` at the repo root runs the client tests and the type checks of the client, web and widget. The client suite gives **111 passed**: crypto, key wrapping, E2EE, Merkle proofs, consent states, forget residue, attestation verification (model and gateway, with tamper cases) on captured real reports, receipts and rules, knowledge bases, retrieval, workspaces, and the blob gate and NVIDIA forwarder.

## What is stored where
The app has no backend of its own that sees prompts or replies. Nothing is kept by us after a response returns: an unsaved chat exists only in the browser tab and is gone on reload.

| Place | What it holds | Can read your chat? |
|---|---|---|
| Browser tab memory | The conversation in progress, your NEAR AI key | You |
| Browser localStorage | Keys for sessions you saved, the testnet inline wallet key, a model owner's decryption key (dev build) | You |
| Blob store: Supabase Storage behind the `blob-gate` Edge Function (or the local dev store) | AES-256-GCM ciphertext of sessions you chose to save, and public round manifests (lists of session hashes) | No. It never gets a key. Forget deletes the blob. |
| NEAR contract (public) | Session hashes and blob pointers, consent records with expiry and wrapped keys, scores, attestation hashes, Merkle roots | No. Hashes and keys only. |
| NEAR AI Cloud | Receives prompts encrypted to the attested enclave key and returns replies encrypted to an ephemeral browser key | Only the verified enclave. Their own retention policy is theirs; we claim no more than E2EE plus TEE. |
| Widget relay (`widget/relay.ts`, run by a site owner) | Holds the site owner's NEAR AI key and the site's public config. For each request it forwards the encrypted body and returns the reply, then keeps nothing: no content, no logs of requests, no database. Its only state is an in-memory per-IP counter for rate limiting, which is lost on restart. | No. It sees ciphertext only, and refuses any request that is not end-to-end encrypted. |
| The embedded widget (in a visitor's browser) | The conversation, in the tab. No cookies, no localStorage. | The visitor |
| NVIDIA forwarder (the `blob-gate` function when deployed, else the Vite dev server's `/nras` proxy) | Forwards NVIDIA's public attestation evidence, which carries a nonce and no user data, to one fixed NVIDIA URL. Stateless, and it cannot forge a verdict. | No |

A model owner can read a session only after the user grants consent, and keeps a copy once decrypted.

## Attestation verification
`client/src/verify.ts` follows the NEAR AI verification guide. For a fresh nonce it checks the **model** (below), then the **gateway** attestation in the same report with the same quote, key-binding, RTMR3 and compose checks (the docs name it the first step; the example verifier reads only its address). After a completion, the **response signature** is checked in `receipt.ts` in both formats the API uses: `provider_tee` (the model's key, signed text `model:requestHash:responseHash`) and `gateway` (the gateway's key, `requestHash:responseHash`). The checks follow the `near-ai-cloud` agent skill from `near/agent-skills` (read from its source) and its reference files on model, gateway and chat verification. Not implemented: the TLS binding (a connection-level check a browser cannot make), Sigstore build provenance (the verifier lists the container image digests each enclave attests to, so they can be looked up on search.sigstore.dev, and marks the step "not verified"), and a pinned list of approved app versions. For the model:
1. The report lists model attestations and echoes our nonce (no replay).
2. **Intel TDX quote**: signature chain and TCB status verified against Intel collateral (via `@phala/dcap-qvl` and Phala's PCCS). Accepted statuses: `UpToDate`, `SWHardeningNeeded`.
3. The enclave is not in debug mode.
4. **REPORT_DATA** taken from the verified quote equals the model's signing key followed by our nonce.
5. The **event log replays to the quote's RTMR3**, and the **docker compose hashes to the quote's MRCONFIGID**.
6. **NVIDIA GPUs**: the evidence goes to NVIDIA's attestation service. The overall token must say true, carry our nonce and be unexpired, and then **every GPU's own token** is checked: secure boot on, debug disabled, measurements passed, every `x-nvidia-*` verification flag true, no warning, the same nonce, and the same set of GPUs as the overall token. All tokens must verify against NVIDIA's published keys. Checking only the overall verdict is a pitfall the guide names; a real attestation covers 8 H100s.

NVIDIA's service refuses browser requests, so the evidence is posted through a forwarder: the `blob-gate` function in a hosted build, or the dev server's `/nras` proxy locally. The forwarder cannot change the outcome, because the signed token is checked in the browser against NVIDIA's own keys, fetched directly. It accepts GPU evidence only, to one fixed URL, with a 2 MB cap.

Only after all of this does the app pin the model key and encrypt to it.

Not checked: the enclave's TLS binding to the gateway; whether the measured app version is on an approved list (we confirm the hardware and that the app it measured is the one served, not that the app is trustworthy); Sigstore provenance; NVIDIA's per-GPU tokens beyond the overall verdict. The contract anchors a hash of the report. It does not verify attestations on-chain.

## Answer receipts and the policy registry
A receipt lets someone who was not in the conversation check that an answer really came from an attested NEAR AI enclave, and which policy (master prompt plus guardrails) it was given.

- **What the enclave signs.** NEAR AI signs `model:sha256(request body):sha256(response body)` with an ed25519 key, readable at `/v1/signature/<id>`. It works with E2EE on: the hashes cover the encrypted bytes. That key is the same one the TDX quote binds, which `verifyReceipt` checks.
- **What a receipt holds.** The exact request and response bodies, the signature, the attestation report and nonce, and the hash of the policy (prompt and rules). It can optionally disclose the prompt and reply together with the ephemeral keys, so a verifier can decrypt them and confirm they match the signed bytes. A proof-only copy omits those keys and reveals nothing.
- **Policy registry.** `publish_policy(site_id, policy_hash, uri)` on the contract. Only the site owner can add versions, old versions stay, and `policy_at(site_id, ms)` returns the policy in force at a given time. Only the hash is stored.
- **In the app.** Chat has a Policy box: it is sent as the system message, and you can publish its hash. Receipts are opt-in: tick "Allow receipts for this chat", then press "Get receipt" on the answers you want. They go into a receipt log (in memory only) where you can check each one fully and save it as proof-only or with content. Unticking wipes what was kept. The Receipts tab verifies a saved file, with the full Intel TDX and NVIDIA check if you leave it on, and compares the policy with the registry.
- **Command line.** `cd client && npm run receipt -- out.json` (key in `client/.env`) runs one real completion and verifies the receipt it writes. A captured one is in `client/test/fixtures/receipt.json`, and the tamper tests are in `client/test/receipt.test.ts`.

**Rules a program can check.** A policy is the prompt plus mechanical rules: a word limit, text that must or must not appear, a pattern that must not match (for example a social security number). The registered hash covers both. With a receipt that discloses its content, a verifier decrypts the reply from the signed response and re-runs every rule on it. The result is two separate verdicts: *authentic* (this exchange really went through the enclave) and *obeyed the rules* (every checkable rule held), and the second is only meaningful when the policy hash matches the one registered on NEAR. The widget enforces the same rules: a reply that breaks one is withheld, and its receipt still proves the violation, so a site cannot hide it.

What it does not prove: rules cannot express tone or judgement, so a prompt line such as "never give legal advice" is not proven to have been obeyed, only that it was sent. A site can also register a policy and never use it, which a receipt without the matching hash would reveal. Compliance is only checked on receipts that disclose their content.

## Private retrieval
This is what "using" a shared session means here. In the Model owner tab, **Answer with consented memory** re-checks consent on NEAR for every question, decrypts only the sessions shared with that model right now, ranks them against the question in the browser (BM25 keyword scoring, with a relevance cutoff so an unrelated session is never sent), and sends the best few as context inside an end-to-end encrypted request. It lists the sources it used and can anchor that use as a round, so each user can verify their session was one of them.

Nothing is trained, so there is no lag: muting, revoking or forgetting a session removes it from the very next answer. `client/scripts/memory-demo.ts` shows it against the real enclave: asked about a pipeline timeout, the model gives generic advice without memory, and with one consented session it names the exact setting from that session.

What it does not do: the model owner sees the plaintext of what is shared with them (that is the consent), retrieval is keyword-based rather than semantic, and the context is sent to the enclave, not kept private from the model.

## Knowledge base per workspace (verifiable RAG)
Each workspace can have its own documents. In the Workspaces tab they are split into passages and hashed into a Merkle tree, and the root goes **inside the policy that is registered on NEAR**, so changing one passage means a new registered version. The widget accepts the passages a relay serves only if they rebuild that root; a relay that adds, removes or alters a passage switches the chat off, which also blocks poisoned documents. Retrieval runs in the visitor's browser (BM25 with a relevance cutoff), so the question never leaves it unencrypted, and the chosen passages travel inside the encrypted request to the enclave. The model is told to cite sources like [1], to treat the passages as data and not instructions, and not to guess when nothing matches; the widget shows which sources an answer used. A receipt with its content disclosed carries the used passages with Merkle proofs, and the verifier checks each one belongs to the registered knowledge base and appears in the signed request.

Two workspaces keep two separate knowledge bases: in the browser test, the same question gets the dental clinic's price from one and no invented answer from the pizza shop.

**Semantic search in a TEE.** By default, questions are matched to passages by shared words (BM25). An owner can instead press **Build semantic index in the TEE** in the Workspaces tab. NEAR AI Cloud serves an embedding model (`Qwen/Qwen3-Embedding-0.6B`) inside its own attested TEE, and its E2EE protocol covers embeddings, so:
- Each passage is embedded once, in that enclave, with the text encrypted to the enclave's verified key. The 1024-number vectors (quantized to one byte each, about 1.4 KB per passage) are **covered by the Merkle root**, so a relay that swaps two vectors to point a question at the wrong passage is caught the same way an edited passage is. Editing a passage drops its vector; a half-built index is never registered or served.
- A visitor's question is embedded in the same enclave, encrypted to it. The widget verifies that enclave fully (Intel TDX and NVIDIA GPUs) on the first message, pins its key, and ranks passages by cosine similarity in the browser. Neither the site nor its relay can read the question; the relay only forwards ciphertext and allows exactly one embedding model.
- The cutoffs come from measurement on the real model: relevant passages scored 0.45 to 0.60, unrelated questions mostly under 0.30. Passages under 0.40 are never used, and any more than 0.12 below the best are dropped. In the browser test a question with no word in common with the passage ("what do you charge for the initial appointment?") finds the price passage, which keyword search could not. If the embedding service is unavailable, the widget falls back to keyword search rather than failing.

**Sealed knowledge base (hidden from visitors, read only in the TEE).** For a workspace's documents that should not be published, choose **Sealed: only the enclave** in the Workspaces tab. Nothing is served to the visitor's page at all:
- The relay encrypts the whole knowledge base to the enclave's key and hands the visitor's browser an opaque ciphertext, which the browser forwards inside its own encrypted request as a second system message. The page, the network and any script on the host site see only hex. Only the attested enclave reads it.
- There is no retrieval step: the model reads all of it for every question (its context window holds about a million tokens, and the app shows the size and the per-message cost, for example about 5,000 tokens is roughly $0.0004). So there is no index to trust, no vector arithmetic outside the TEE, and no similarity cutoff to tune.
- **The relay seals only to a key it has verified itself.** If it sealed to any key a caller named, a visitor could ask for the knowledge base sealed to their own key and read it. So `/seal` first runs the full attestation check (Intel TDX and NVIDIA GPUs) on the site's model and seals only to the key that passes; the test confirms an attacker's key is refused with 403.
- **Auditable, not just trusted.** Sealing is deterministic (secrets derived from the relay's `SEAL_SECRET`), so the owner can later reproduce the secret for a given request with `POST /s/<site>/audit` (needs `AUDIT_TOKEN`) and attach it to a receipt as `disclosure.sealedAudit`. A third party then verifies, in the Receipts tab, that the sealed message in the signed request held exactly those passages and that they are the knowledge base whose fingerprint is registered on NEAR. A forged or edited audit fails.

What sealed mode does **not** do: a visitor cannot check the passages themselves (only an audit can show what was sealed). It is hidden from the page and the network, **not from a visitor who coaxes the model into repeating it**, so treat it as "not published" rather than "secret": in testing, an instruction to print the whole knowledge base including a staff code was refused, but that is not a guarantee, and the rules (a word limit, forbidden text) bound how much one reply can say. The relay holds the plaintext, so it must be the site owner's own. Every message carries the whole knowledge base as input tokens. There are no per-passage source citations beyond the titles the model chooses to name.

What it does not do (public mode): **the passages and their vectors are readable by visitors' browsers**, so it is for public material (prices, hours, policies, FAQs), not secrets. The vector arithmetic runs in the browser, not in a TEE; what runs in the TEE is the embedding model. A knowledge base hidden from visitors would need the relay to add sealed context to each request, which is future work. The cutoffs were measured on a small set of questions and can miss or over-match on a very different knowledge base. The limits are 300 passages or 300,000 characters.

## Embeddable widget
`widget/` is a private AI chat any site can paste in, with a master prompt and rules set by the site. Before a visitor can type, the widget checks that the site's policy matches the hash registered on NEAR, and otherwise switches itself off. Messages are encrypted in the visitor's browser to the attested enclave, so the site's relay (which holds the API key) sees only ciphertext. See [widget/README.md](widget/README.md).

**Create your own workspace in the app.** The **Workspaces** tab walks through it: name and greeting, the instructions, the rules a program checks on every reply (word limit, must mention, must never say, no social security, card or email numbers), a tester for sample replies, then **Publish to NEAR** (registers the fingerprint, and makes you the owner of the site id), **Save site to this relay** and **Open a live preview**, plus the embed code. One relay serves many workspaces at `/s/<siteId>/`, and picks up a new one without a restart. Run `npm run widget:relay` and `npm run widget:demo`. The save button only works with the local dev server; otherwise download the site file into `widget/sites/`.

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
