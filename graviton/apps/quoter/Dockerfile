# Build from the monorepo root:
#   docker build -f graviton/apps/quoter/Dockerfile -t graviton-quoter .

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

# ── workspace manifests ────────────────────────────────────────────
# --frozen-lockfile validates the whole workspace, so every manifest has to be
# here; --filter then installs only the quoter's subgraph. Shared by both
# stages below so the list lives in one place.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY graviton/packages/core/package.json ./graviton/packages/core/
COPY graviton/apps/quoter/package.json ./graviton/apps/quoter/
COPY graviton/apps/relayer/package.json ./graviton/apps/relayer/
COPY graviton/apps/server/package.json ./graviton/apps/server/
COPY guardian/package.json ./guardian/
COPY packages/agent-protocol/package.json ./packages/agent-protocol/
COPY sdk/package.json ./sdk/
COPY wallet/package.json ./wallet/

# ── build ──────────────────────────────────────────────────────────
FROM manifests AS builder
RUN pnpm install --frozen-lockfile --filter "@graviton/quoter..."

COPY graviton/tsconfig.base.json ./graviton/
COPY graviton/packages/core ./graviton/packages/core
COPY graviton/apps/quoter ./graviton/apps/quoter
RUN pnpm --filter "@graviton/quoter..." build

# ── runtime ────────────────────────────────────────────────────────
FROM manifests AS runner

ENV NODE_ENV=production
# tini reaps zombies and forwards SIGTERM, which node-as-PID-1 ignores.
RUN apk add --no-cache tini

# Prod deps only. The store is dropped afterwards — node_modules hardlinks
# survive it, so this is pure size saving. The chown matters: COPY preserves
# host file modes and many manifests here are 0600, unreadable to USER node.
RUN pnpm install --frozen-lockfile --prod --filter "@graviton/quoter..." \
  && rm -rf "$(pnpm store path)" \
  && chown -R node:node /app

COPY --from=builder --chown=node:node /app/graviton/packages/core/dist ./graviton/packages/core/dist
COPY --from=builder --chown=node:node /app/graviton/apps/quoter/dist ./graviton/apps/quoter/dist

USER node
WORKDIR /app/graviton/apps/quoter

EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
