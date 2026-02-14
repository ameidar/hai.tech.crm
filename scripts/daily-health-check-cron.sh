#!/usr/bin/env bash
# Cron companion — runs health check in JSON mode and logs to dated file
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../logs"
mkdir -p "$LOG_DIR"
"$SCRIPT_DIR/daily-health-check.sh" --json > "$LOG_DIR/health-$(date +%Y-%m-%d).json" 2>&1
