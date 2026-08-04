# Build from the monorepo root:
#   docker build -f guardian/apps/guardian-agent/Dockerfile -t guardian-agent .

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

# ── workspace manifests ────────────────────────────────────────────
# --frozen-lockfile validates the whole workspace, so every manifest has to be
# here; --filter then installs only this service's subgraph.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY graviton/packages/core/package.json ./graviton/packages/core/
COPY graviton/apps/quoter/package.json ./graviton/apps/quoter/
COPY graviton/apps/relayer/package.json ./graviton/apps/relayer/
COPY graviton/apps/server/package.json ./graviton/apps/server/
COPY guardian/apps/guardian-agent/package.json ./guardian/apps/guardian-agent/
COPY packages/agent-protocol/package.json ./packages/agent-protocol/
COPY sdk/package.json ./sdk/
COPY wallet/package.json ./wallet/

# ── runtime ────────────────────────────────────────────────────────
FROM manifests AS runner

# tini reaps zombies and forwards SIGTERM, which node-as-PID-1 ignores.
RUN apk add --no-cache tini

# ponytail: no build stage. The agent and its vendored tracer are authored with
# extensionless ESM imports (moduleResolution "bundler"), which tsc does not
# rewrite, so the image runs TypeScript directly under tsx. Add a build stage
# only if startup cost or the dev-dependency surface starts to matter.
# The store is dropped afterwards — node_modules hardlinks survive it, so this
# is pure size saving. The chown matters: COPY preserves host file modes and
# many manifests here are 0600, unreadable to USER node.
RUN pnpm install --frozen-lockfile --filter "@mallow/guardian-agent-service..." \
  && rm -rf "$(pnpm store path)" \
  && chown -R node:node /app

COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node guardian/apps/guardian-agent ./guardian/apps/guardian-agent

ENV NODE_ENV=production
USER node
WORKDIR /app/guardian/apps/guardian-agent

EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
