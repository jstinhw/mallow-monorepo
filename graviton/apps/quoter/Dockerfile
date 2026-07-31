# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/graviton-quoter/package.json ./apps/graviton-quoter/
COPY packages/core/package.json ./packages/core/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY apps/graviton-quoter ./apps/graviton-quoter

# Build packages
RUN pnpm --filter @graviton/core build
RUN pnpm --filter @graviton/quoter build

# Stage 2: Production
FROM node:20-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/graviton-quoter/package.json ./apps/graviton-quoter/
COPY packages/core/package.json ./packages/core/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/apps/graviton-quoter/dist ./apps/graviton-quoter/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

EXPOSE 3002

CMD ["node", "apps/graviton-quoter/dist/index.js"]
