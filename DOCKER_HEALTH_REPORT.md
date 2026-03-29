# Docker Health Report — HaiTech CRM

**Timestamp:** 2026-02-14 08:49 UTC (Saturday)

---

## 1. Container Status (`docker ps -a`)

| Container | Image | Status | Ports |
|-----------|-------|--------|-------|
| haitech-redis | redis:7-alpine | ✅ Up 13 min (healthy) | 6379 |
| haitech-api-dev | haitech-crm-api-dev | ✅ Up 13 min (healthy) | 3002→3002 |
| haitech-db | postgres:16-alpine | ✅ Up 9 days (healthy) | 5432 |

**haitech-api (prod):** ✅ Not running (as expected — stopped)

---

## 2. Resource Usage (`docker stats`)

| Container | CPU | Memory | MEM % |
|-----------|-----|--------|-------|
| haitech-redis | 0.39% | 11.45 MiB | 0.07% |
| haitech-api-dev | 0.00% | 41.25 MiB | 0.27% |
| haitech-db | 0.00% | 46.66 MiB | 0.30% |

All containers using minimal resources. ✅

---

## 3. API Dev Logs (`haitech-api-dev --tail 30`)

Only `prisma:query SELECT 1` health-check pings. **No errors.** ✅

---

## 4. Redis Logs (`haitech-redis --tail 20`)

Normal RDB background saves every ~60s. **No errors.** ✅

---

## 5. PostgreSQL Logs (`haitech-db --tail 20`)

- Routine checkpoints — normal ✅
- ⚠️ **One ERROR** at 08:23:50: `column m.cycleId does not exist` — a manual query used camelCase instead of snake_case (`cycleId` → `cycle_id`). This was a one-off ad-hoc query, not from the application. **Not a concern.**

---

## 6. Redis Replication

- **Role:** master ✅
- **Connected slaves:** 0
- **Failover state:** no-failover

Redis confirmed running as master. ✅

---

## 7. Redis Memory

- **Used:** 1.61 MB
- **RSS:** 13.22 MB
- **Peak:** 1.69 MB
- **System total:** 15.17 GB
- **Eviction policy:** noeviction

Memory usage negligible. ✅

---

## 8. Database Size

- **haitech_crm:** 15 MB ✅

---

## 9. Disk Space

| Filesystem | Size | Used | Avail | Use% |
|------------|------|------|-------|------|
| /dev/mapper/ocivolume-root | 30G | 21G | 9.2G | 69% |

⚠️ **69% disk usage** — monitor but not critical yet. Consider cleanup if it approaches 80%.

---

## 10. API Health Endpoint

```json
{"status":"ok","timestamp":"2026-02-14T08:49:50.858Z","version":"1.0.0","database":"connected"}
```

API responding, DB connected. ✅

---

## 11. Production Container

haitech-api (prod) is **not running** — confirmed stopped as expected. ✅

---

## 12. Docker Compose Redis Fix

```yaml
command: redis-server --save 60 1 --replicaof no one
```

Redis command fix is in place (`--replicaof no one` to force master mode). ✅

---

## Overall Assessment: ✅ HEALTHY

All 3 containers running and healthy. No application errors. API responding correctly. Redis in master mode with minimal memory usage. DB at 15 MB.

**One note:** Disk at 69% — not urgent but worth monitoring.
