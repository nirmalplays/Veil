# Veil widget

A private AI chat that any website can embed. The site sets a master prompt and rules (the *policy*), and visitors can check that the chat is running that exact policy and that every reply obeyed its rules.

```html
<script type="module" src="https://your-site.example/veil-widget.js"
        data-relay="https://relay.your-site.example" data-accent="#1f3a5f"></script>
```

## Parts
- **Widget** (`src/widget.ts`): a Shadow DOM panel, so the host page's CSS cannot touch it. It loads the site config from the relay, hashes the policy (prompt and rules) and compares it with the hash registered on NEAR (`get_policy`). If the policy is not registered, or does not match, the chat is switched off. Every reply is checked against the rules before the visitor sees it; one that breaks a rule is withheld and replaced with the site's fallback text, and its receipt still proves the violation. Messages are encrypted in the visitor's browser to an attested NEAR AI enclave (E2EE). The full attestation check (Intel TDX and NVIDIA) loads on the first message and is cached for that conversation. Nothing is stored: no cookies, no localStorage.
- **Relay** (`relay.ts`): the website cannot keep a NEAR AI API key in browser code, so this small server keeps it and only forwards. It refuses any chat request that is not E2EE, checks the model, caps `max_tokens`, rate-limits per IP, can restrict origins, and forwards bodies byte for byte (the enclave signs a hash of the exact bytes). It also forwards NVIDIA's attestation call, which browsers cannot make directly. Because the browser encrypts to the enclave, **the relay and the site owner see only ciphertext**.
- **Receipts**: off by default. The visitor ticks "Allow receipts", then picks answers in a receipt log (not in the thread) and saves them as proof-only or with content. Verify a saved file in the Veil app's Receipts tab. Site owners can turn the option off with `"receipts": "off"`.

## Run the demo
```
npm run setup                                   # once, from the repo root
NEARAI_API_KEY=... npm run widget:relay         # prints the policy hash and the command to register it
npm run widget:demo                             # then open http://localhost:5174/demo/index.html
```
The demo site is the fictional Harbor & Finch law firm. Its policy (`demo/site.json`, site id `harbor-law-demo`) is already registered on `veil-31da02.testnet`. To use your own, edit `site.json`, run the printed `near contract call-function … publish_policy` command as the site owner, and restart the relay. Editing the policy without re-registering it switches the chat off, which is the point.

## Site config (`site.json`)
`siteId`, `title`, `greeting`, `policy` (`{ prompt, rules }`), `fallback`, `model`, `contract`, `receipts` (`off` or `visitor`), optional `allowedOrigins`, `maxTokens`, `ratePerMinute`. The policy text is public on purpose: visitors can read what the assistant was told.

## What this does not do
- Only rules a program can check (word limit, required or forbidden text, patterns) are enforced and provable. Tone and judgement in the prompt are instructions a model can still ignore: the registry and receipts show which prompt was published and sent, not that the model obeyed it.
- The relay sees metadata (time, IP, message size), and the site owner pays for usage. The relay's rate limit is per IP and in memory.
- The relay must be hosted by the site owner. This repo ships it as a Node script, not a managed service.
- Testnet contract only.
