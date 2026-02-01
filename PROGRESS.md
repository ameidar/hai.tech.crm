# HaiTech CRM - Progress Tracker

## Phase 1: Foundation ✅ COMPLETED

### Completed ✅
- [x] Project structure setup
- [x] PostgreSQL database schema (schema.sql)
- [x] Prisma schema with all entities
- [x] Docker configuration (docker-compose.yml, Dockerfile)
- [x] Node.js/Express backend with TypeScript
- [x] JWT authentication system (login, register, refresh, me)
- [x] Role-based access control (admin, manager, instructor)
- [x] CRUD endpoints for all main entities:
  - [x] Users (auth)
  - [x] Customers
  - [x] Students
  - [x] Courses
  - [x] Branches
  - [x] Institutional Orders
  - [x] Instructors
  - [x] Cycles (with auto meeting generation)
  - [x] Meetings (with postpone functionality)
  - [x] Registrations (with payment tracking)
  - [x] Attendance (with bulk recording)
- [x] Input validation with Zod
- [x] Error handling middleware
- [x] Database seed script
- [x] Documentation (README.md)

### Architecture Decisions
1. **ORM**: Prisma for type-safe database access with auto-generated types
2. **Auth**: JWT with refresh tokens, bcrypt for password hashing
3. **Structure**: Routes → Middleware → Prisma (simple, no separate service layer)
4. **Validation**: Zod schemas for request validation
5. **Enums**: Defined at database level and mirrored in TypeScript

### Fireberry Migration Mapping
| Fireberry Object | Fireberry ID | HaiTech Entity | Key Fields Mapping |
|-----------------|--------------|----------------|-------------------|
| לקוחות | account | Customer | accountname → name |
| הרשמות | 33 | Registration + Student | pcfsystemfield204 → student.name, accountname → customer |
| מחזורים | 1000 | Cycle | pcfsystemfield85 → instructor_id, pcfsystemfield28name → course |
| מדריכים | 1002 | Instructor | pcfsystemfield536 → rateFrontal |
| פגישות | 6 | Meeting | pcfsystemfield559 → revenue, pcfsystemfield547 → instructorPayment |

### Files Created
```
backend/
├── package.json
├── tsconfig.json
├── Dockerfile
├── .env.example
├── .gitignore
├── README.md
├── schema.sql
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
└── src/
    ├── index.ts
    ├── config.ts
    ├── middleware/
    │   ├── auth.ts
    │   └── errorHandler.ts
    ├── routes/
    │   ├── auth.ts
    │   ├── customers.ts
    │   ├── students.ts
    │   ├── courses.ts
    │   ├── branches.ts
    │   ├── instructors.ts
    │   ├── cycles.ts
    │   ├── meetings.ts
    │   ├── registrations.ts
    │   └── attendance.ts
    ├── types/
    │   └── schemas.ts
    └── utils/
        └── prisma.ts

docker-compose.yml
PROGRESS.md
PLANNING.md
```

---

## Phase 2: Core Features (Next)
- [ ] Frontend React app setup with TypeScript
- [ ] Admin dashboard
  - [ ] Overview page with today's meetings
  - [ ] Meeting status indicators
  - [ ] Quick stats (revenue, students, etc.)
- [ ] Cycle management UI
  - [ ] Create/edit cycle form
  - [ ] View meetings timeline
- [ ] Meeting status reporting (instructor view)
  - [ ] Daily meetings list
  - [ ] Attendance recording form
  - [ ] Status update (completed/cancelled/postponed)
- [ ] Reports
  - [ ] Daily report
  - [ ] Monthly billing report

## Phase 3: Automation
- [ ] Green API integration (WhatsApp)
  - [ ] Send reminder templates
  - [ ] Instructor reminders (day before, hour before)
  - [ ] Parent reminders (if enabled)
- [ ] Automated reminders via cron/Bull queue
- [ ] Monthly billing calculation
- [ ] Zoom API integration for online meetings

## Phase 4: Polish
- [ ] Calendar view (FullCalendar integration)
- [ ] Advanced reports (by branch, by instructor)
- [ ] Instructor portal (separate view)
- [ ] Data migration scripts from Fireberry
- [ ] Export to Excel

---

## Quick Start

```bash
cd /home/opc/clawd/projects/haitech-crm/backend

# Option 1: Docker (recommended)
docker-compose up -d

# Option 2: Local
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

## API Base URL
- Local: http://localhost:3001/api
- Health check: GET /api/health

## Default Admin (after seeding)
- Email: admin@haitech.co.il
- Password: admin123

## Test the API

```bash
# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@haitech.co.il","password":"admin123"}'

# Use the returned accessToken for authenticated requests
curl http://localhost:3001/api/courses \
  -H "Authorization: Bearer <token>"
```
