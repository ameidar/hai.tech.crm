#!/bin/bash
# HaiTech CRM - Start Dev Server (port 3002)
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/tmp/haitech-backend.log"

echo "🚀 Starting HaiTech CRM on port 3002..."

# Start DB + Redis if not running
cd "$REPO_DIR"
sg docker -c "docker compose up -d db redis" 2>/dev/null || docker compose up -d db redis

# Wait for DB
sleep 2

# Kill old backend if running
pkill -f "haitech.*index.ts" 2>/dev/null || true
sleep 1

# Start backend
cd "$REPO_DIR/backend"
nohup node -r tsx/cjs src/index.ts > "$LOG_FILE" 2>&1 &
echo "Backend PID: $!"

# Wait and verify
sleep 3
if curl -s http://localhost:3002/api/health | grep -q "ok"; then
  echo "✅ Server is up: http://187.124.2.69:3002"
  echo "   Email:    admin@haitech.co.il"
  echo "   Password: admin123"
else
  echo "❌ Something went wrong. Check logs: $LOG_FILE"
fi
