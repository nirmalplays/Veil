# Veil relay as a container. Runs anywhere Docker does (free hosting: see "Host the relay for free" in widget/README.md); inside a dstack TEE it can also attest itself.
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
# Sites: the demo site is built in. Free hosts have no volumes, so to serve your own workspaces add a COPY of them to /app/widget/sites/ here.
# Secrets (NEARAI_API_KEY, SEAL_SECRET, AUDIT_TOKEN) come from the host's environment settings, never from the image.
# tsx is run directly (not through npx) so the container also works as a non-root user with a read-only home.
CMD ["widget/node_modules/.bin/tsx", "widget/relay.ts"]
