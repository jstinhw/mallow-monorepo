# Build context MUST be the repo root (workspace deps live outside the service).
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:/root/.foundry/bin:$PATH
RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10 --activate
RUN curl -L https://foundry.paradigm.xyz | bash && /root/.foundry/bin/foundryup
WORKDIR /app

# ponytail: whole-repo copy, not per-package. A partial copy makes pnpm see
# fewer workspace importers than the lockfile lists and --frozen-lockfile
# fails. Split it back out if build times start hurting.
COPY . .

RUN pnpm install --frozen-lockfile \
    --filter @mallow/guardian-agent-service...

WORKDIR /app/guardian/apps/guardian-agent
EXPOSE 3002
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
