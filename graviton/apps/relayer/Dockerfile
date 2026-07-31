# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/graviton-relayer/package.json ./apps/graviton-relayer/
COPY packages/core/package.json ./packages/core/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY apps/graviton-relayer ./apps/graviton-relayer

# Build packages
RUN pnpm --filter @graviton/core build
RUN pnpm --filter @graviton/relayer build

# Stage 2: API Production
FROM node:20-alpine AS api

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/graviton-relayer/package.json ./apps/graviton-relayer/
COPY packages/core/package.json ./packages/core/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/apps/graviton-relayer/dist ./apps/graviton-relayer/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/v1/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

EXPOSE 3001

CMD ["node", "apps/graviton-relayer/dist/index.js"]

# Stage 3: Worker Production
FROM node:20-alpine AS worker

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/graviton-relayer/package.json ./apps/graviton-relayer/
COPY packages/core/package.json ./packages/core/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/apps/graviton-relayer/dist ./apps/graviton-relayer/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist

CMD ["node", "apps/graviton-relayer/dist/worker.js"]
