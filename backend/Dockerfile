# HaiTech CRM Backend Dockerfile
FROM node:22-alpine AS base

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source code
COPY tsconfig.json ./
COPY src ./src/
COPY scripts ./scripts/

# Copy frontend dist if available
COPY frontend-dist ./frontend-dist/

# Build
FROM base AS builder
ARG APP_VERSION=unknown
ARG COMMIT_SHA=unknown
ARG GIT_BRANCH=unknown
ARG BUILD_TIME=
RUN BUILD_TIME="${BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" \
    APP_VERSION="$APP_VERSION" \
    COMMIT_SHA="$COMMIT_SHA" \
    GIT_BRANCH="$GIT_BRANCH" \
    npm run build && \
    mkdir -p dist/data && \
    cp -r src/data/* dist/data/ 2>/dev/null || true && \
    cp src/version.json dist/version.json 2>/dev/null || true

# Production image
FROM node:22-alpine AS production

WORKDIR /app

# Copy only necessary files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/frontend-dist ./frontend-dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
