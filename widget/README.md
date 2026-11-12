# Veil widget

A private AI chat that any website can embed. The site sets a master prompt and rules (the *policy*), and visitors can check that the chat is running that exact policy and that every reply obeyed its rules.

```html
<script defer src="https://your-site.example/veil-widget.js"
        data-relay="https://relay.your-site.example/s/your-site-id" data-accent="#1f3a5f"></script>
```

Get the file with `npm run widget:build`: it writes **one self-contained file**, `widget/dist/veil-widget.js` (about 520 KB, 160 KB compressed; it includes the full attestation verifier), and copies it to `web/public/` so the Workspaces tab can offer it as a download. Upload it to your site's static files.

## Parts
- **Widget** (`src/widget.ts`): a Shadow DOM panel, so the host page's CSS cannot touch it. It loads the site config from the relay, hashes the policy (prompt and rules) and compares it with the hash registered on NEAR (`get_policy`). If the policy is not registered, or does not match, the chat is switched off. Every reply is checked against the rules before the visitor sees it; one that breaks a rule is withheld and replaced with the site's fallback text, and its receipt still proves the violation. Messages are encrypted in the visitor's browser to an attested NEAR AI enclave (E2EE). The full attestation check (Intel TDX and NVIDIA) loads on the first message and is cached for that conversation. Nothing is stored: no cookies, no localStorage.
- **Relay** (`relay.ts`): the website cannot keep a NEAR AI API key in browser code, so this small server keeps it and only forwards. It refuses any chat request that is not E2EE, checks the model, caps `max_tokens`, rate-limits per IP, can restrict origins, and forwards bodies byte for byte (the enclave signs a hash of the exact bytes). It also forwards NVIDIA's attestation call, which browsers cannot make directly. Because the browser encrypts to the enclave, **the relay and the site owner see only ciphertext**.
- **Receipts**: off by default. The visitor ticks "Allow receipts", then picks answers in a receipt log (not in the thread) and saves them as proof-only or with content. Verify a saved file in the Veil app's Receipts tab. Site owners can turn the option off with `"receipts": "off"`.

## Create a workspace
The fastest way is the **Workspaces** tab in the Veil app: it writes the site file, registers the policy on NEAR with your wallet, saves the file into `widget/sites/`, and links to a live preview. By hand, put a `site.json` (see below) in `widget/sites/`, register its policy hash with the command the relay prints, and open `/demo/preview.html?relay=http://localhost:8790/s/<siteId>`. A single relay serves every file in `sites/` plus the bundled demo, and re-reads them on each request.

## Run the demo
```
npm run setup                                   # once, from the repo root
cp widget/.env.example widget/.env              # once; put your NEAR AI key in .env (git-ignored, never sent to a browser)
npm run widget:relay                            # reads .env; prints the policy hash and the command to register it
npm run widget:demo                             # then open http://localhost:5174/demo/index.html
```
The demo site is the fictional Harbor & Finch law firm. Its policy (`demo/site.json`, site id `harbor-law-demo`) is already registered on `veil-31da02.testnet`. To use your own, edit `site.json`, run the printed `near contract call-function … publish_policy` command as the site owner, and restart the relay. Editing the policy without re-registering it switches the chat off, which is the point.

## Site config (`site.json`)
`siteId`, `title`, `greeting`, `policy` (`{ prompt, rules, kb }`), `fallback`, `kb` (`{ chunks }`, the passages behind `policy.kb`), `model`, `contract`, `receipts` (`off` or `visitor`), optional `allowedOrigins`, `maxTokens`, `ratePerMinute`. The policy text is public on purpose: visitors can read what the assistant was told.

## Knowledge base
A site file may carry `kb.chunks` (title and text). The relay serves them at `/s/<siteId>/kb`; the registered policy holds their Merkle root (`policy.kb`), and the widget refuses to run if the copy it gets does not rebuild it. Build one in the app's Workspaces tab (step 4). The passages are readable by visitors, so keep secrets out. With a semantic index (`policy.kb.embed`), the relay also allows E2EE requests to `/v1/embeddings` for that one embedding model and its attestation, so a visitor's question is embedded in a TEE and never read by the relay. Chunks then carry a `vec`, which is covered by the registered root.

## Sealed knowledge base
With `policy.kb.mode: "sealed"` the relay never serves the passages (`/kb` is 404). Instead `POST /s/<site>/seal` returns the knowledge base encrypted to an enclave key, and only after the relay has fully verified that key as a genuine enclave for the site's model (so a visitor cannot ask for it sealed to their own key). The widget forwards that ciphertext as the second message of its own encrypted request. Set `SEAL_SECRET` (so sealing is reproducible) and `AUDIT_TOKEN` (to turn on `POST /s/<site>/audit`) in `widget/.env`; the audit returns the secret and passages for a given enclave key, which the owner can attach to a receipt for a third party to verify.

## What this does not do
- Only rules a program can check (word limit, required or forbidden text, patterns) are enforced and provable. Tone and judgement in the prompt are instructions a model can still ignore: the registry and receipts show which prompt was published and sent, not that the model obeyed it.
- The relay sees metadata (time, IP, message size), and the site owner pays for usage. The relay's rate limit is per IP and in memory.
- The relay must be hosted by the site owner. This repo ships it as a Node script, not a managed service.
- Testnet contract only.

## Run the relay inside a TEE

The relay holds your NEAR AI key and the seal secret, so on a normal server whoever runs the machine can read them. Run it in a TEE and they can't.

1. Build and push the image (from the repo root): `docker build -f widget/Dockerfile -t <you>/veil-relay .`, then push it and note its `sha256` digest.
2. Put `VEIL_RELAY_IMAGE=<you>/veil-relay@sha256:<digest>`, `NEARAI_API_KEY`, `SEAL_SECRET` and `AUDIT_TOKEN` in `widget/.env`.
3. Deploy with Phala Cloud (dstack): `phala deploy --compose widget/docker-compose.tee.yml --env-file widget/.env`. The env file is encrypted to the enclave before it leaves your machine.
4. Ask the running relay to prove it: `GET /relay-attestation?nonce=<64 hex characters>` returns an Intel TDX quote that carries your nonce, plus the compose hash of what is running.

Status: the route and the container files are written. The route returns a clear 501 outside a TEE (tested). I have not deployed to Phala yet, so the quote path is untested, and the client does not yet verify the relay's quote the way it verifies the model's.
