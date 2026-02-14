#!/usr/bin/env bash
set -u

# HaiTech CRM Daily Health Check
# Usage: ./daily-health-check.sh [--json]

###############################################################################
# Config
###############################################################################
API_BASE="http://localhost:3002/api"
API_USER="admin@haitech.co.il"
API_PASS="admin123"
CONTAINERS=("haitech-api-dev" "haitech-db" "haitech-redis")
DISK_THRESHOLD=90

###############################################################################
# State
###############################################################################
PASSED=0
FAILED=0
JSON_MODE=false
JSON_RESULTS=()

[[ "${1:-}" == "--json" ]] && JSON_MODE=true

###############################################################################
# Helpers
###############################################################################
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'; BOLD='\033[1m'

report() {
  local name="$1" status="$2" detail="${3:-}"
  if $JSON_MODE; then
    local escaped_detail
    escaped_detail=$(echo "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr '\n' ' ')
    JSON_RESULTS+=("{\"check\":\"$name\",\"status\":\"$status\",\"detail\":\"$escaped_detail\"}")
  else
    if [[ "$status" == "OK" ]]; then
      echo -e "  ${GREEN}✔ PASS${NC}  $name${detail:+ — $detail}"
    else
      echo -e "  ${RED}✘ FAIL${NC}  $name${detail:+ — $detail}"
    fi
  fi
  if [[ "$status" == "OK" ]]; then ((PASSED++)) || true; else ((FAILED++)) || true; fi
}

section() {
  $JSON_MODE || echo -e "\n${BOLD}═══ $1 ═══${NC}"
}

###############################################################################
# 1. Docker containers
###############################################################################
section "Docker Containers"
for c in "${CONTAINERS[@]}"; do
  state=$(sudo docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "not_found")
  if [[ "$state" == "running" ]]; then
    report "$c container" "OK" "running"
  else
    report "$c container" "FAIL" "state=$state"
  fi
done

###############################################################################
# 2. API health endpoint
###############################################################################
section "API Health"
health_resp=$(curl -sf -m 10 "$API_BASE/health" 2>&1) && health_ok=true || health_ok=false
if $health_ok; then
  report "API /health" "OK" "$health_resp"
else
  report "API /health" "FAIL" "unreachable or non-200"
fi

###############################################################################
# 3. DB connectivity
###############################################################################
section "Database"
db_out=$(sudo docker exec haitech-db psql -U haitech -d haitech_crm -t -c "SELECT 1" 2>&1) && db_ok=true || db_ok=false
if $db_ok && echo "$db_out" | grep -q "1"; then
  report "DB SELECT 1" "OK"
else
  report "DB SELECT 1" "FAIL" "$db_out"
fi

###############################################################################
# 4. Redis ping
###############################################################################
section "Redis"
redis_ping=$(sudo docker exec haitech-redis redis-cli ping 2>&1) || true
if [[ "$redis_ping" == "PONG" ]]; then
  report "Redis PING" "OK"
else
  report "Redis PING" "FAIL" "$redis_ping"
fi

###############################################################################
# 5. Redis replication role
###############################################################################
redis_role=$(sudo docker exec haitech-redis redis-cli INFO replication 2>&1) || true
if echo "$redis_role" | grep -q "role:master"; then
  report "Redis role=master" "OK"
else
  report "Redis role=master" "FAIL" "not master"
fi

###############################################################################
# 6. Disk space
###############################################################################
section "Disk Space"
while read -r pct mount; do
  usage=${pct%\%}
  if (( usage >= DISK_THRESHOLD )); then
    report "Disk $mount" "FAIL" "${pct} used (>=${DISK_THRESHOLD}%)"
  else
    report "Disk $mount" "OK" "${pct} used"
  fi
done < <(df -h --output=pcent,target -x tmpfs -x devtmpfs -x overlay 2>/dev/null | tail -n+2 | awk '{print $1, $2}')

###############################################################################
# 7. DB size
###############################################################################
section "Database Size"
db_size=$(sudo docker exec haitech-db psql -U haitech -d haitech_crm -t -c "SELECT pg_size_pretty(pg_database_size('haitech_crm'))" 2>&1) && db_size_ok=true || db_size_ok=false
if $db_size_ok; then
  report "DB size" "OK" "$(echo "$db_size" | xargs)"
else
  report "DB size" "FAIL" "$db_size"
fi

###############################################################################
# 8. API smoke tests (login + endpoints)
###############################################################################
section "API Smoke Tests"
TOKEN=""
login_resp=$(curl -sf -m 10 -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$API_USER\",\"password\":\"$API_PASS\"}" 2>&1) && login_ok=true || login_ok=false

if $login_ok; then
  TOKEN=$(echo "$login_resp" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ -z "$TOKEN" ]]; then
    # Try access_token or accessToken
    TOKEN=$(echo "$login_resp" | grep -oE '"(access_token|accessToken)"\s*:\s*"[^"]*"' | head -1 | cut -d'"' -f4)
  fi
fi

if [[ -n "$TOKEN" ]]; then
  report "API login" "OK"
  AUTH="Authorization: Bearer $TOKEN"
  for ep in instructors cycles meetings customers; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H "$AUTH" "$API_BASE/$ep" 2>/dev/null) || code="000"
    if [[ "$code" == "200" ]]; then
      report "GET /api/$ep" "OK" "HTTP $code"
    else
      report "GET /api/$ep" "FAIL" "HTTP $code"
    fi
  done
else
  report "API login" "FAIL" "no token received"
  for ep in instructors cycles meetings customers; do
    report "GET /api/$ep" "FAIL" "skipped (no auth)"
  done
fi

###############################################################################
# 9. Orphaned records
###############################################################################
section "Data Integrity"
orphan_queries=(
  "Meetings without cycles|SELECT COUNT(*) FROM meetings WHERE cycle_id IS NOT NULL AND cycle_id NOT IN (SELECT id FROM cycles)"
  "Meetings without instructor|SELECT COUNT(*) FROM meetings WHERE instructor_id IS NOT NULL AND instructor_id NOT IN (SELECT id FROM instructors)"
)
for entry in "${orphan_queries[@]}"; do
  label="${entry%%|*}"
  query="${entry#*|}"
  count=$(sudo docker exec haitech-db psql -U haitech -d haitech_crm -t -c "$query" 2>&1 | xargs) || count="error"
  if [[ "$count" == "0" ]]; then
    report "$label" "OK" "0 orphans"
  elif [[ "$count" =~ ^[0-9]+$ ]]; then
    report "$label" "FAIL" "$count orphan(s)"
  else
    report "$label" "FAIL" "$count"
  fi
done

###############################################################################
# Summary
###############################################################################
TOTAL=$((PASSED + FAILED))
if $JSON_MODE; then
  echo "{"
  echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"passed\": $PASSED,"
  echo "  \"failed\": $FAILED,"
  echo "  \"total\": $TOTAL,"
  echo "  \"checks\": ["
  for i in "${!JSON_RESULTS[@]}"; do
    if (( i < ${#JSON_RESULTS[@]} - 1 )); then
      echo "    ${JSON_RESULTS[$i]},"
    else
      echo "    ${JSON_RESULTS[$i]}"
    fi
  done
  echo "  ]"
  echo "}"
else
  echo ""
  echo -e "${BOLD}═══ Summary ═══${NC}"
  echo -e "  Total: $TOTAL | ${GREEN}Passed: $PASSED${NC} | ${RED}Failed: $FAILED${NC}"
  if (( FAILED == 0 )); then
    echo -e "  ${GREEN}All checks passed ✔${NC}"
  else
    echo -e "  ${RED}Some checks failed ✘${NC}"
  fi
  echo ""
fi

exit $(( FAILED > 0 ? 1 : 0 ))
