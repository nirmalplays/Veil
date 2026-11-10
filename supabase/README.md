# Supabase storage for Veil

Sessions are encrypted in the browser, so Supabase only ever holds ciphertext. The private bucket is reachable only through the `blob-gate` Edge Function, which uses the NEAR contract (not Supabase Auth) to decide who may read what.

| Who | Can do |
|---|---|
| Anyone with the anon key | Nothing on the `blobs` bucket (no policies). Can read public round manifests. |
| A signed-in NEAR account | Upload, read and delete objects under its own prefix `blobs/<account>/…`. |
| A model owner | Read a session's blob only while the contract says they own the model **and** the session has live consent for it. Mute, expiry, revoke and forget all cut access immediately. |

Sign-in: the app signs a NEP-413 message with the user's wallet (`recipient: veil-blob-gate`). The gate checks the signature and that the key is an access key of that account on-chain, then returns a one-hour token.

## NVIDIA forwarder
The same function also exposes `POST …/blob-gate/nras/v3/attest/gpu`. NVIDIA's attestation service rejects browser CORS preflights, so a hosted build cannot call it directly. The route forwards GPU attestation evidence to that one fixed URL and returns NVIDIA's answer. It needs no sign-in, because the evidence is public. The caller verifies NVIDIA's signed token against NVIDIA's own keys (fetched directly), so the forwarder cannot forge a verdict. It rejects anything that is not GPU evidence and anything over 2 MB. There is no rate limit beyond Supabase's own; add one if the demo gets public traffic. No extra setup: the web app uses it automatically whenever `VITE_SUPABASE_URL` or `VITE_GATE_URL` is set.

## Set it up (about 10 minutes)
1. Create a project at https://supabase.com/dashboard and note the project ref and URL.
2. Install the CLI and link: `npx supabase login && npx supabase link --project-ref <ref>`
3. Create the buckets: `npx supabase db push` (runs `migrations/0001_storage.sql`).
4. Set the secrets and deploy:
   ```
   npx supabase secrets set GATE_SECRET=$(openssl rand -hex 32) VEIL_CONTRACT=veil-31da02.testnet
   npx supabase functions deploy blob-gate --no-verify-jwt
   ```
5. Point the web app at it (`web/.env.local`, never committed):
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```
   With these set, `web/` uses Supabase. Without them it uses the local dev blob store.

## Try the gate without Supabase
`cd web && npm run gate` starts the same gate logic over a local in-memory/disk store on http://localhost:8788, and `VITE_GATE_URL=http://localhost:8788` points the app at it. The gate logic is unit-tested in `client/test/gate.test.ts`.

## Limits
- Per-object size is capped by the bucket (5 MB). Signed upload URLs cannot enforce more than that.
- The one-hour token is a bearer token. Anyone who steals it can act as that account for an hour, within the rules above.
- Deleting an object removes it from Supabase Storage. Supabase's own backups and retention are theirs.
