# HaiTech CRM - API Layer Work Plan

## סקירת שלבים

```
Phase 0: תשתית (1-2 שבועות)
    ↓
Phase 1: MVP - Core CRUD (2-3 שבועות)
    ↓
Phase 2: Business Logic (2-3 שבועות)
    ↓
Phase 3: אבטחה והרשאות (1-2 שבועות)
    ↓
Phase 4: Webhooks & Integrations (1-2 שבועות)
    ↓
Phase 5: דוחות וייצוא (1 שבוע)
    ↓
Phase 6: תיעוד ובדיקות (1-2 שבועות)
    ↓
Production Ready
```

---

## Phase 0: תשתית

### משך: 1-2 שבועות

### Deliverables

#### 0.1 Project Structure
- [ ] מבנה תיקיות חדש (`api/v1/`)
- [ ] Base classes (Controller, Service, Repository)
- [ ] Error handling אחיד (custom error classes)
- [ ] Response formatting middleware

#### 0.2 Configuration
- [ ] Environment variables validation (Zod)
- [ ] Config service עם type safety
- [ ] Multi-environment support (dev/staging/prod)

#### 0.3 Logging
- [ ] Pino setup עם structured logging
- [ ] Request ID middleware (correlation)
- [ ] Request/response logging
- [ ] Error logging עם stack traces

#### 0.4 Validation
- [ ] Zod schemas לכל entity
- [ ] Validation middleware
- [ ] Error formatting לשגיאות validation

#### 0.5 Database
- [ ] Connection pooling optimization
- [ ] Query logging (development)
- [ ] Transaction wrapper utility

### תלויות
- Node.js 18+
- PostgreSQL database (קיים)
- Prisma setup (קיים)

### Definition of Done
- [ ] אפשר להריץ `npm run dev` ולקבל server פעיל
- [ ] GET `/api/v1/health` מחזיר 200
- [ ] כל request מקבל correlation ID
- [ ] Logs נכתבים בפורמט JSON

---

## Phase 1: MVP - Core CRUD

### משך: 2-3 שבועות

### עדיפות גבוהה (Week 1)

#### 1.1 Authentication
- [ ] POST `/auth/login` - JWT generation
- [ ] POST `/auth/refresh` - Token refresh
- [ ] GET `/auth/me` - Current user
- [ ] Auth middleware עם JWT validation

#### 1.2 Customers CRUD
- [ ] GET `/customers` - List with pagination
- [ ] GET `/customers/:id` - Single customer
- [ ] POST `/customers` - Create
- [ ] PUT `/customers/:id` - Update
- [ ] DELETE `/customers/:id` - Soft delete

#### 1.3 Students CRUD
- [ ] GET `/students` - List with filters
- [ ] GET `/students/:id` - Single student
- [ ] POST `/students` - Create
- [ ] PUT `/students/:id` - Update
- [ ] DELETE `/students/:id` - Soft delete

### עדיפות בינונית (Week 2)

#### 1.4 Courses CRUD
- [ ] Full CRUD endpoints
- [ ] Category filtering

#### 1.5 Branches CRUD
- [ ] Full CRUD endpoints
- [ ] Type filtering

#### 1.6 Instructors CRUD
- [ ] Full CRUD endpoints
- [ ] Relation to User

### עדיפות נמוכה (Week 3)

#### 1.7 Cycles CRUD
- [ ] Full CRUD endpoints
- [ ] Complex filtering (date range, status, type)
- [ ] Relations (course, branch, instructor)

#### 1.8 Meetings CRUD
- [ ] Full CRUD endpoints
- [ ] Date-based filtering
- [ ] Relation to cycle & instructor

#### 1.9 Registrations CRUD
- [ ] Full CRUD endpoints
- [ ] Student-Cycle relation

### Definition of Done - Phase 1
- [ ] כל entity יש CRUD מלא
- [ ] Pagination עובד בכל list endpoints
- [ ] Filtering עובד לפי הפרמטרים המתועדים
- [ ] Soft delete מיושם
- [ ] בדיקות ידניות עוברות (Postman/curl)

---

## Phase 2: Business Logic

### משך: 2-3 שבועות

### Week 1: Cycles & Meetings

#### 2.1 Cycle Operations
- [ ] POST `/cycles/:id/generate-meetings` - יצירת פגישות אוטומטית
- [ ] POST `/cycles/:id/sync-progress` - סנכרון מונים
- [ ] POST `/cycles/:id/duplicate` - שכפול מחזור
- [ ] POST `/cycles/bulk-update` - עדכון גורף

#### 2.2 Meeting Operations
- [ ] POST `/meetings/:id/complete` - סימון כהושלמה
- [ ] POST `/meetings/:id/cancel` - ביטול
- [ ] POST `/meetings/:id/postpone` - דחייה
- [ ] POST `/meetings/:id/recalculate` - חישוב כספים
- [ ] POST `/meetings/bulk-update-status` - עדכון סטטוס גורף

### Week 2: Registrations & Attendance

#### 2.3 Registration Operations
- [ ] POST `/cycles/:id/registrations` - הרשמה למחזור
- [ ] POST `/registrations/:id/cancel` - ביטול הרשמה
- [ ] POST `/registrations/:id/payment` - עדכון תשלום

#### 2.4 Attendance Operations
- [ ] POST `/meetings/:id/attendance` - רישום נוכחות
- [ ] PUT `/meetings/:id/attendance/bulk` - עדכון גורף
- [ ] GET `/attendance/meeting/:meetingId` - נוכחות בפגישה

### Week 3: Financial Calculations

#### 2.5 Revenue Calculations
- [ ] Meeting revenue based on cycle type
- [ ] Instructor payment calculation
- [ ] Profit calculation
- [ ] Bulk recalculation

#### 2.6 Instructor Operations
- [ ] GET `/instructors/:id/schedule` - לוח זמנים
- [ ] Availability calculation

### Definition of Done - Phase 2
- [ ] יצירת פגישות אוטומטית עובדת
- [ ] חישובי כספים מדויקים
- [ ] נוכחות משפיעה על סטטיסטיקות
- [ ] Integration tests לתהליכים מרכזיים

---

## Phase 3: אבטחה והרשאות

### משך: 1-2 שבועות

#### 3.1 API Keys
- [ ] Model ב-Prisma
- [ ] Generation algorithm (`haitech_live_xxx`)
- [ ] CRUD endpoints
- [ ] Validation middleware
- [ ] Scopes system

#### 3.2 RBAC
- [ ] Role definitions (admin, manager, instructor)
- [ ] Permission matrix
- [ ] Authorization middleware
- [ ] Per-resource permissions

#### 3.3 Rate Limiting
- [ ] Redis integration (or in-memory)
- [ ] Per-user/API-key limits
- [ ] Headers (X-RateLimit-*)
- [ ] 429 response handling

#### 3.4 Audit Logging
- [ ] Automatic logging on mutations
- [ ] Old/new value capture
- [ ] IP & User Agent tracking
- [ ] Query endpoints

#### 3.5 Security Hardening
- [ ] Input sanitization
- [ ] SQL injection prevention (Prisma handles)
- [ ] XSS prevention
- [ ] CORS configuration
- [ ] Helmet middleware

### Definition of Done - Phase 3
- [ ] API Keys עובדים לאינטגרציות
- [ ] Instructor רואה רק את המידע שלו
- [ ] Rate limiting פעיל
- [ ] כל mutation מתועד ב-audit log
- [ ] Security scan נקי

---

## Phase 4: Webhooks & Integrations

### משך: 1-2 שבועות

#### 4.1 Webhook Infrastructure
- [ ] Webhook model (URL, events, secret)
- [ ] HMAC signature generation
- [ ] Delivery queue (background job)
- [ ] Retry mechanism
- [ ] Delivery logging

#### 4.2 Events
- [ ] Event emission service
- [ ] Events: customer.*, student.*, registration.*, meeting.*, cycle.*

#### 4.3 Webhook Management
- [ ] CRUD endpoints
- [ ] Test endpoint
- [ ] Delivery history

#### 4.4 External Integrations
- [ ] POST `/public/leads` - Lead ingestion
- [ ] Zoom webhook handler (קיים, לשפר)
- [ ] n8n/Make examples

### Definition of Done - Phase 4
- [ ] Webhooks נשלחים בהצלחה
- [ ] Retry עובד ל-failures
- [ ] HMAC signature נבדקת בצד הלקוח
- [ ] דוגמאות n8n/Make מתועדות

---

## Phase 5: דוחות וייצוא

### משך: 1 שבוע

#### 5.1 Reports API
- [ ] GET `/reports/revenue` - דוח הכנסות
- [ ] GET `/reports/instructor-payments` - תשלומים למדריכים
- [ ] GET `/reports/attendance-summary` - סיכום נוכחות
- [ ] GET `/reports/cycle-progress` - התקדמות מחזורים

#### 5.2 Export
- [ ] POST `/reports/export` - Async export
- [ ] CSV generation
- [ ] XLSX generation (optional)
- [ ] Download endpoint

### Definition of Done - Phase 5
- [ ] דוחות מחזירים נתונים מדויקים
- [ ] ייצוא CSV עובד
- [ ] Performance סביר (<5s לדוחות גדולים)

---

## Phase 6: תיעוד ובדיקות

### משך: 1-2 שבועות

#### 6.1 OpenAPI Documentation
- [ ] Complete OpenAPI 3.0 spec
- [ ] Swagger UI integration
- [ ] Examples לכל endpoint
- [ ] Error responses מתועדים

#### 6.2 Integration Guide
- [ ] Getting started guide
- [ ] Authentication guide
- [ ] Common flows (registration, meeting completion)
- [ ] n8n/Make templates

#### 6.3 Testing
- [ ] Unit tests לservices
- [ ] Integration tests לendpoints
- [ ] Auth tests (permissions)
- [ ] Load testing (k6 or similar)

#### 6.4 Deployment
- [ ] Docker setup
- [ ] CI/CD pipeline
- [ ] Environment configs
- [ ] Monitoring setup

### Definition of Done - Phase 6
- [ ] Swagger UI עובד בproduction
- [ ] Test coverage >80% על services
- [ ] Load test: 100 req/s sustained
- [ ] Deployment docs מוכנים

---

## Production Checklist

### אבטחה
- [ ] HTTPS only
- [ ] API Keys מוגדרים
- [ ] Rate limiting פעיל
- [ ] CORS מצומצם
- [ ] Secrets ב-environment variables

### ביצועים
- [ ] Database indexes optimized
- [ ] Connection pooling
- [ ] Caching where needed
- [ ] Pagination enforced

### ניטור
- [ ] Health checks
- [ ] Error tracking (Sentry/similar)
- [ ] Metrics (response times, error rates)
- [ ] Alerting configured

### תיעוד
- [ ] API docs public
- [ ] Changelog maintained
- [ ] Migration guides ready

---

## Timeline Summary

| Phase | Duration | Priority |
|-------|----------|----------|
| Phase 0: תשתית | 1-2 weeks | 🔴 Critical |
| Phase 1: MVP CRUD | 2-3 weeks | 🔴 Critical |
| Phase 2: Business Logic | 2-3 weeks | 🔴 Critical |
| Phase 3: אבטחה | 1-2 weeks | 🟠 High |
| Phase 4: Webhooks | 1-2 weeks | 🟡 Medium |
| Phase 5: דוחות | 1 week | 🟡 Medium |
| Phase 6: תיעוד | 1-2 weeks | 🟠 High |
| **Total** | **10-15 weeks** | |

### MVP (לאינטגרציות בסיסיות)
Phases 0-1: **3-5 שבועות**

### Full Release
All phases: **10-15 שבועות**

---

## הערות

1. **הזמנים משוערים** - תלוי בזמינות ובמורכבות בפועל
2. **חלק מהקוד קיים** - הroutes הנוכחיים יכולים לשמש בסיס
3. **עדיפות לMVP** - אפשר לצאת עם Phase 0-2 ולהמשיך iteratively
4. **בדיקות מקבילות** - כדאי לכתוב tests במקביל לפיתוח
