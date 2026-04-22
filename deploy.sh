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

# NOTE: Git tagging is intentionally NOT done from production.
# Run `scripts/tag-release.sh` from the dev machine (187.124.2.69) after merge to main
# to create and push the vX.Y.Z tag. Production has no git write credentials by design.

# Verify
echo ""
echo "✅ Deploy complete!"
echo "🔗 https://crm.orma-ai.com"
echo "📊 Running version:"
curl -s http://localhost:3001/api/version | head -c 400
echo ""
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep haitech
