# HaiTech CRM - Architecture & Deployment Guide

## Overview

This document describes the system architecture, deployment process, and development workflow for HaiTech CRM.

---

## System Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, TypeScript, TailwindCSS 4, Vite |
| **Backend** | Node.js, Express, TypeScript |
| **Database** | PostgreSQL with Prisma ORM |
| **Reverse Proxy** | Caddy |
| **SSL/HTTPS** | Cloudflare (Flexible mode) |

### Project Structure

```
/home/opc/clawd/projects/haitech-crm/
├── backend/
│   ├── src/           # API source code (routes, services, middleware)
│   ├── prisma/        # Database schema and migrations
│   ├── dist/          # Compiled JavaScript (production code)
│   └── tests/         # Unit tests (Vitest)
├── frontend/
│   ├── src/           # React components
│   └── dist/          # Production build
├── e2e/               # Playwright E2E tests
├── docker-compose.yml # Container setup (not currently used in production)
└── .github/workflows/ # CI pipelines (tests only, no deployment)
```

---

## Production Environment

### Key Point: This Machine IS Production

There is **no separate production server**. The CRM runs directly on this machine (`n8n-customers`).

```
crm.orma-ai.com
      │
      ▼
  Cloudflare (SSL termination)
      │
      ▼
  129.159.133.209 (this server's public IP)
      │
      ▼
  Caddy (port 80, reverse proxy)
      │
      ▼
  localhost:3001 (Node.js backend)
```

### What's Running

| Component | Location | Port |
|-----------|----------|------|
| Backend API | `/home/opc/clawd/projects/haitech-crm/backend/dist/` | 3001 |
| Frontend | Served by backend (static files) | - |
| PostgreSQL | Local or Docker | 5432 |
| Caddy | Reverse proxy | 80 |

### Configuration Files

- **Backend env**: `/home/opc/clawd/projects/haitech-crm/backend/.env`
- **API Token**: `/home/opc/clawd/projects/haitech-crm/.api-token`
- **Caddy config**: `/etc/caddy/Caddyfile`

---

## Deployment Process

### Current State: Manual Deployment

There is **no automated deployment**. GitHub Actions runs tests only, not deployments.

### How to Deploy Changes

1. **Edit code** in the source files (`backend/src/` or `frontend/src/`)

2. **Build the project**:
   ```bash
   cd /home/opc/clawd/projects/haitech-crm
   
   # Build backend
   cd backend
   npm run build
   
   # Build frontend (if changed)
   cd ../frontend
   npm run build
   cp -r dist ../backend/frontend-dist
   ```

3. **Restart the server**:
   ```bash
   # Find and kill the running process
   pkill -f "node dist/index.js"
   
   # Start again
   cd /home/opc/clawd/projects/haitech-crm/backend
   NODE_ENV=production node dist/index.js &
   ```

4. **Verify**:
   ```bash
   curl https://crm.orma-ai.com/api/health
   ```

### Important Warnings

⚠️ **Code changes here affect production immediately after restart**

⚠️ **There is no staging environment** - test carefully before deploying

⚠️ **Git is not synced automatically** - push changes manually to preserve history

---

## Git Workflow

### Repository

- **Remote**: `git@github.com:ameidar/hai.tech.crm.git`
- **Main branches**: `main` (production), `dev` (development)

### Branch Naming

| Prefix | Purpose |
|--------|---------|
| `feature/*` | New features |
| `fix/*` | Bug fixes |
| `test/*` | Test additions |

### Existing Feature Branches

- `feature/api-layer`
- `feature/audit-log`
- `feature/custom-views`
- `feature/design-improvements`
- `feature/import-cycles`
- `feature/instructor-envelope-budget`
- `feature/integrations`
- `feature/mobile-instructor-ui`
- `feature/pagination`
- `feature/rtl-support`
- `feature/security-hardening`
- `feature/soft-delete`
- `feature/testing-ci`

### Recommended Workflow

```bash
# 1. Create feature branch
git checkout dev
git pull origin dev
git checkout -b feature/my-feature

# 2. Make changes and commit
git add .
git commit -m "Add feature X"

# 3. Push to remote
git push origin feature/my-feature

# 4. Create PR to dev (GitHub)

# 5. After merge, deploy manually (see deployment steps above)
```

---

## CI/CD Pipeline

### What GitHub Actions Does

Located in `.github/workflows/`:

1. **CI Pipeline** (on push/PR to dev/main):
   - TypeScript type checking
   - Unit tests (Vitest)
   - Build verification

2. **E2E Pipeline** (on PR + nightly):
   - Smoke tests (Playwright)
   - Regression tests (scheduled)

### What GitHub Actions Does NOT Do

- ❌ Deploy to production
- ❌ Sync code to server
- ❌ Restart services

---

## Database

### Connection

```
DATABASE_URL=postgresql://haitech:PASSWORD@localhost:5432/haitech_crm
```

### Prisma Commands

```bash
cd backend

# Generate Prisma client after schema changes
npx prisma generate

# Push schema changes to database (no migration)
npx prisma db push

# Create migration (for tracked changes)
npx prisma migrate dev --name description

# View database in browser
npx prisma studio
```

### Main Entities

- Users (authentication)
- Courses (course catalog)
- Branches (schools, locations)
- Cycles (class groups)
- Meetings (scheduled sessions)
- Instructors (teachers)
- Students
- Customers (parents)
- Registrations
- Attendance

---

## API Reference

Base URL: `https://crm.orma-ai.com/api`

### Authentication

```bash
# Login
curl -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@haitech.co.il","password":"admin123"}'

# Use token in subsequent requests
curl "$BASE/endpoint" \
  -H "Authorization: Bearer $TOKEN"
```

### Main Endpoints

| Resource | Endpoints |
|----------|-----------|
| Cycles | GET/POST/PUT/DELETE `/cycles` |
| Meetings | GET/POST/PUT/DELETE `/meetings` |
| Instructors | GET/POST/PUT/DELETE `/instructors` |
| Students | GET/POST/PUT/DELETE `/students` |
| Customers | GET/POST/PUT/DELETE `/customers` |
| Registrations | GET/PUT/DELETE `/registrations` |
| Attendance | GET/POST/PUT `/attendance` |

---

## Future Improvements

### Recommended Changes

1. **Add automated deployment**:
   - GitHub Actions workflow to deploy on merge to `main`
   - Or webhook-based deployment

2. **Add staging environment**:
   - Separate server for testing before production

3. **Use process manager**:
   - PM2 or systemd for reliable process management
   - Auto-restart on crash

4. **Docker production setup**:
   - docker-compose.yml already exists
   - Would provide consistent environment

---

## Quick Reference

### Useful Commands

```bash
# Check if API is running
curl http://localhost:3001/api/health

# View logs (if using PM2)
pm2 logs haitech-api

# Check what's using port 3001
lsof -i :3001

# Test production URL
curl https://crm.orma-ai.com/api/health
```

### File Locations

| What | Where |
|------|-------|
| Source code | `/home/opc/clawd/projects/haitech-crm/` |
| Backend build | `/home/opc/clawd/projects/haitech-crm/backend/dist/` |
| Frontend build | `/home/opc/clawd/projects/haitech-crm/frontend/dist/` |
| Environment vars | `/home/opc/clawd/projects/haitech-crm/backend/.env` |
| Caddy config | `/etc/caddy/Caddyfile` |
| API token | `/home/opc/clawd/projects/haitech-crm/.api-token` |

---

*Last updated: 2026-02-10*
