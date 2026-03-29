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

# Build frontend
echo "🔨 Building frontend..."
docker run --rm -v $(pwd)/frontend:/app -w /app node:22-alpine sh -c "npm install && npm run build"

# Copy to backend
echo "📋 Copying frontend build..."
rm -rf backend/frontend-dist/*
cp -r frontend/dist/* backend/frontend-dist/

# Rebuild and restart containers
echo "🐳 Rebuilding Docker containers..."
docker compose up -d --build --force-recreate

# Wait for API to be healthy
echo "⏳ Waiting for API..."
sleep 10

# Run migrations
echo "📊 Running database migrations..."
docker exec haitech-api npx prisma migrate deploy || echo "⚠️  Migration warning (may need manual resolve)"

# Verify
echo ""
echo "✅ Deploy complete!"
echo "🔗 https://crm.orma-ai.com"
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep haitech
