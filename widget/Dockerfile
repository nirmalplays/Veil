# Veil relay as a container, meant to run inside a TEE (dstack / Phala Cloud).
# Build from the repository root:  docker build -f widget/Dockerfile -t veil-relay .
# Pin the base image by digest when you publish, so the attested compose hash names exactly this build.
FROM node:22-slim
WORKDIR /app
COPY client/package.json client/package-lock.json client/
COPY widget/package.json widget/
RUN npm --prefix client ci --omit=dev && npm --prefix widget install --omit=dev && npm --prefix widget install --no-save tsx
COPY client/src client/src
COPY client/tsconfig.json client/
COPY widget/relay.ts widget/
COPY widget/demo/site.json widget/demo/site.json
ENV PORT=8790
EXPOSE 8790
# Workspaces live on a volume (mounted at /data/sites). Secrets (NEARAI_API_KEY, SEAL_SECRET, AUDIT_TOKEN) arrive as encrypted env vars
# that only the enclave can decrypt, so the host never sees them.
CMD ["npx", "--prefix", "widget", "tsx", "widget/relay.ts", "/data/sites"]
