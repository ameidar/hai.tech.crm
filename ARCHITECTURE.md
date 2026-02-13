# HaiTech CRM - Architecture & Deployment Guide

## Overview

This document describes the system architecture, deployment process, and development workflow for HaiTech CRM.

---

## System Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, TypeScript, TailwindCSS 4, Vite, React Query |
| **Backend** | Node.js, Express, TypeScript |
| **Database** | PostgreSQL with Prisma ORM |
| **Reverse Proxy** | Caddy |
| **SSL/HTTPS** | Cloudflare (Flexible mode) |
| **Integrations** | Zoom API, Green API (WhatsApp) |

### Project Structure

```
/home/opc/clawd/projects/haitech-crm/
├── backend/
│   ├── src/
│   │   ├── index.ts            # Express app entry point
│   │   ├── config.ts           # Environment configuration
│   │   ├── routes/             # API route handlers (25 route files)
│   │   ├── services/           # Business logic services
│   │   ├── middleware/         # Auth & error handling
│   │   ├── utils/              # Prisma client, helpers
│   │   └── types/              # TypeScript type definitions
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema (18 models)
│   │   └── seed.ts             # Database seeding
│   └── dist/                   # Compiled JavaScript (production)
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Main app with routing
│   │   ├── pages/              # Page components (21 pages)
│   │   ├── components/         # Reusable components
│   │   ├── context/            # Auth context
│   │   ├── hooks/              # Custom React hooks
│   │   ├── api/                # API client
│   │   └── types/              # TypeScript types
│   └── dist/                   # Production build
├── e2e/
│   ├── tests/                  # Playwright E2E tests
│   ├── page-objects/           # Page object models
│   └── fixtures/               # Test fixtures
├── migration/                  # Fireberry migration scripts
├── scripts/                    # Utility scripts
└── docker-compose.yml          # Container setup
```

---

## Backend Architecture

### API Routes (25 endpoints)

| Route | Description |
|-------|-------------|
| `/api/auth` | Authentication (login, register, refresh, me) |
| `/api/invite` | Instructor invitation system |
| `/api/customers` | Customer CRUD |
| `/api/students` | Student CRUD |
| `/api/courses` | Course catalog CRUD |
| `/api/branches` | Branch management CRUD |
| `/api/instructors` | Instructor CRUD + rates |
| `/api/cycles` | Cycle management + meeting generation |
| `/api/meetings` | Meeting CRUD + status updates |
| `/api/registrations` | Student registrations |
| `/api/attendance` | Attendance tracking |
| `/api/audit` | Audit log viewing |
| `/api/views` | Saved custom views |
| `/api/webhook` | External webhooks |
| `/api/communication` | Email/notification sending |
| `/api/messaging` | WhatsApp messaging (Green API) |
| `/api/zoom` | Zoom meeting management |
| `/api/zoom-webhook` | Zoom event webhooks |
| `/api/instructor-magic` | Magic link for instructors |
| `/api/parent` | Parent mobile app API |
| `/api/expenses` | Expense tracking (cycle & meeting) |
| `/api/forecast` | Financial forecasting |
| `/api/meeting-status` | Public meeting status updates |

### Services

| Service | Purpose |
|---------|---------|
| `instructor-reminder.service.ts` | Automated instructor reminders |
| `messaging.ts` | WhatsApp message sending |
| `notifications.ts` | Push notifications |
| `transcription.ts` | Zoom recording transcription |
| `zoom.ts` | Zoom API integration |

### Middleware

- **auth.ts** - JWT authentication & role-based access
- **errorHandler.ts** - Centralized error handling

---

## Frontend Architecture

### Pages (21 total)

| Page | Description |
|------|-------------|
| **Login** | Authentication |
| **Dashboard** | Main dashboard with stats & forecast chart |
| **Customers** | Customer list & management |
| **CustomerDetail** | Single customer with students |
| **Students** | Student list & management |
| **Courses** | Course catalog |
| **Branches** | Branch management |
| **Instructors** | Instructor management with rates |
| **Cycles** | Cycle list & management |
| **CycleDetail** | Cycle with meetings, registrations, Zoom, expenses |
| **Meetings** | Meeting list & management |
| **Reports** | Reporting & analytics |
| **AuditLog** | System audit trail |
| **InstructorDashboard** | Instructor-specific view |
| **InviteSetup** | Instructor invitation setup |
| **ResetPassword** | Password reset flow |
| **MeetingStatus** | Public meeting status page |
| **InstructorMagicMeeting** | Magic link meeting page |

#### Mobile Instructor Pages
| Page | Description |
|------|-------------|
| **MobileMeetings** | Mobile-optimized meeting list |
| **MobileMeetingDetail** | Mobile meeting detail & attendance |
| **MobileAttendanceOverview** | Attendance summary |
| **MobileProfile** | Instructor profile |

### Components

| Component | Purpose |
|-----------|---------|
| **Layout** | Main app layout with navigation |
| **MobileInstructorLayout** | Mobile layout for instructors |
| **AttendanceModal** | Attendance recording dialog |
| **BulkMeetingEditModal** | Bulk meeting operations |
| **CycleExpenses** | Cycle-level expense management |
| **MeetingExpenses** | Per-meeting expense tracking |
| **ForecastChart** | Financial forecast visualization |
| **MeetingDetailModal** | Meeting details popup |
| **MeetingEditModal** | Meeting edit dialog |
| **SendMessageModal** | WhatsApp message composer |
| **ViewSelector** | Custom view management |

---

## Database Schema

### Models (18 total)

#### Core Entities
- **User** - System users with roles (admin, manager, instructor)
- **Customer** - Parents/contacts
- **Student** - Children linked to customers
- **Course** - Course catalog
- **Branch** - Schools, community centers, etc.
- **Instructor** - Teachers with rate types

#### Business Entities
- **InstitutionalOrder** - B2B contracts
- **Cycle** - Class groups with schedule
- **Registration** - Student-to-cycle enrollment
- **Meeting** - Scheduled sessions
- **Attendance** - Per-meeting presence tracking

#### Support Entities
- **AuditLog** - Change tracking
- **SavedView** - Custom table views
- **CycleExpense** - Recurring cycle costs
- **MeetingExpense** - One-time meeting costs

### Key Enums
- UserRole: admin, manager, instructor
- CycleType: private, institutional_per_child, institutional_fixed
- ActivityType: online, frontal, private
- MeetingStatus: scheduled, completed, cancelled, postponed
- ExpenseStatus: pending, approved, rejected

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
| PostgreSQL | Local | 5432 |
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

## Integrations

### Zoom API
- **Purpose**: Create recurring meetings for online cycles
- **Features**:
  - Auto-create Zoom meetings for cycles
  - Recording/transcript webhook handling
  - Host key management for instructors
  - Meeting password generation

### Green API (WhatsApp)
- **Purpose**: Send reminders and notifications
- **Features**:
  - Instructor reminders (day before, hour before)
  - Parent notifications (if enabled)
  - Custom message sending
  - Message templates

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

### GitHub Actions

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

## Quick Reference

### Useful Commands

```bash
# Check if API is running
curl http://localhost:3001/api/health

# Check what's using port 3001
lsof -i :3001

# Test production URL
curl https://crm.orma-ai.com/api/health

# Run E2E tests
cd e2e && npx playwright test

# Prisma commands
cd backend
npx prisma generate    # Regenerate client
npx prisma db push     # Push schema changes
npx prisma studio      # Database GUI
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
| E2E tests | `/home/opc/clawd/projects/haitech-crm/e2e/` |

---

*Last updated: 2025-02-13*
