#!/bin/bash
# HaiTech CRM - Production Deploy Script
# Usage: ./deploy.sh
set -e

echo "🚀 HaiTech CRM Deploy"
echo "====================="

# Ensure we're on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "⚠️  Switching to main branch..."
  git checkout main
fi

# Pull latest
echo "📥 Pulling latest from main..."
git pull origin main

# Capture version metadata (passed as Docker build args)
export APP_VERSION=$(node -p "require('./backend/package.json').version")
export COMMIT_SHA=$(git rev-parse --short HEAD)
export GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
export BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "📌 Version: v${APP_VERSION} · ${COMMIT_SHA} · ${GIT_BRANCH} · ${BUILD_TIME}"

# Build frontend
echo "🔨 Building frontend..."
docker run --rm -v $(pwd)/frontend:/app -w /app node:22-alpine sh -c "npm install && npm run build"

# Copy to backend
echo "📋 Copying frontend build..."
rm -rf backend/frontend-dist/*
cp -r frontend/dist/* backend/frontend-dist/

# Rebuild and restart containers (build args picked from exported env vars)
echo "🐳 Rebuilding Docker containers..."
docker compose up -d --build --force-recreate

# Wait for API to be healthy
echo "⏳ Waiting for API..."
sleep 10

# Run migrations
echo "📊 Running database migrations..."
docker exec haitech-api npx prisma migrate deploy || echo "⚠️  Migration warning (may need manual resolve)"

# Auto-tag: if package.json version matches no existing tag, create one
TAG="v${APP_VERSION}"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "🏷️  Tag ${TAG} already exists — skipping tag creation"
else
  echo "🏷️  Creating tag ${TAG} (commit ${COMMIT_SHA})..."
  git tag -a "$TAG" -m "Release ${TAG} (${COMMIT_SHA}) deployed at ${BUILD_TIME}"
  git push origin "$TAG" || echo "⚠️  Tag push failed (non-fatal)"
fi

# Verify
echo ""
echo "✅ Deploy complete!"
echo "🔗 https://crm.orma-ai.com"
echo "📊 Running version:"
curl -s http://localhost:3001/api/version | head -c 400
echo ""
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep haitech
