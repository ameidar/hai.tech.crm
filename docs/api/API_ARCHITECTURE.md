# HaiTech CRM - API Architecture & Design Document

## 1. סקירה כללית

### 1.1 מטרת המסמך
מסמך זה מגדיר את ארכיטקטורת ה-API של מערכת HaiTech CRM, כולל סטנדרטים, אבטחה, ותכנית עבודה מפורטת.

### 1.2 עקרונות מנחים
- **RESTful Design** - מבנה צפוי ואחיד
- **Security First** - אימות והרשאות בכל endpoint
- **Auditability** - תיעוד כל פעולה
- **Idempotency** - תמיכה בretries ללא side effects
- **Developer Experience** - תיעוד מלא ודוגמאות

---

## 2. Stack טכנולוגי

### 2.1 בחירת טכנולוגיה (נימוק)

| רכיב | בחירה | נימוק |
|------|-------|-------|
| Framework | **Node.js + Express** | כבר קיים במערכת, ביצועים טובים, ecosystem עשיר |
| ORM | **Prisma** | כבר בשימוש, type-safety, migrations מובנות |
| Auth | **JWT + API Keys** | גמישות - JWT לממשק, API Keys לאינטגרציות |
| Validation | **Zod** | Type-safe validation, אינטגרציה עם TypeScript |
| Docs | **OpenAPI 3.0 + Swagger UI** | סטנדרט תעשייתי, תיעוד אינטראקטיבי |
| Logging | **Pino** | מהיר, structured JSON logs |

### 2.2 מבנה הפרויקט
```
backend/src/
├── api/
│   └── v1/
│       ├── controllers/     # Request handling, validation
│       ├── services/        # Business logic
│       ├── repositories/    # Data access (Prisma)
│       ├── middleware/      # Auth, rate-limit, logging
│       ├── validators/      # Zod schemas
│       └── routes/          # Route definitions
├── common/
│   ├── errors/             # Custom error classes
│   ├── utils/              # Helpers
│   └── types/              # Shared types
├── config/                 # Environment config
└── index.ts               # App entry
```

---

## 3. מיפוי אובייקטים (Entities)

### 3.1 אובייקטים מרכזיים

| אובייקט | תיאור | קשרים |
|---------|-------|-------|
| **User** | משתמשי המערכת | → Instructor (1:1) |
| **Customer** | לקוחות/הורים | → Students (1:N) |
| **Student** | תלמידים | → Customer, Registrations, Attendance |
| **Course** | קורסים | → Cycles (1:N) |
| **Branch** | סניפים/מוסדות | → Cycles, InstitutionalOrders |
| **Instructor** | מדריכים | → User, Cycles, Meetings |
| **InstitutionalOrder** | הזמנות מוסדיות | → Branch, Cycles |
| **Cycle** | מחזורים | → Course, Branch, Instructor, Meetings, Registrations |
| **Meeting** | פגישות/שיעורים | → Cycle, Instructor, Attendance |
| **Registration** | הרשמות | → Student, Cycle, Attendance |
| **Attendance** | נוכחות | → Meeting, Registration/Student |
| **AuditLog** | לוג שינויים | → User |
| **SavedView** | תצוגות שמורות | → User |

### 3.2 דיאגרמת קשרים
```
Customer (1) ──────────────────┐
     │                         │
     └──► (N) Student ─────────┼──► (N) Registration ───► (1) Cycle
                               │           │                  │
                               │           │                  │
                               │           ▼                  │
                               │    (N) Attendance ◄────── (N) Meeting
                               │                              │
                               │                              │
Course (1) ───► (N) Cycle ◄────┴──── (1) Instructor ◄────────┘
                   │
                   │
Branch (1) ────────┘
     │
     └──► (N) InstitutionalOrder
```

---

## 4. עיצוב API

### 4.1 סטנדרטים

#### Base URL
```
https://api.haitech-crm.com/api/v1
```

#### Naming Conventions
- **Resources**: plural, kebab-case (`/customers`, `/institutional-orders`)
- **Actions**: verbs for non-CRUD (`/meetings/{id}/complete`, `/cycles/{id}/generate-meetings`)
- **Query params**: camelCase (`?startDate=2026-01-01&status=active`)

#### HTTP Methods
| Method | שימוש |
|--------|-------|
| GET | קריאה |
| POST | יצירה |
| PUT | עדכון מלא |
| PATCH | עדכון חלקי |
| DELETE | מחיקה (soft by default) |

### 4.2 מבנה Response אחיד

#### Success (Single)
```json
{
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-02-06T12:00:00Z"
  }
}
```

#### Success (List)
```json
{
  "data": [ ... ],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-02-06T12:00:00Z"
  }
}
```

#### Error
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [
      { "field": "email", "message": "Invalid email format" }
    ]
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-02-06T12:00:00Z"
  }
}
```

### 4.3 Pagination
```
GET /customers?limit=20&offset=40
GET /customers?cursor=abc123&limit=20
```

- **Default limit**: 20
- **Max limit**: 100
- **Cursor-based**: מומלץ לרשימות גדולות

### 4.4 Filtering & Sorting
```
GET /meetings?status=completed&instructorId=uuid&from=2026-01-01&to=2026-01-31
GET /cycles?sortBy=startDate&sortOrder=desc
GET /customers?search=ישראל&city=תל אביב
```

### 4.5 Soft Delete vs Hard Delete
- **Default**: Soft delete (`deletedAt` timestamp)
- **Hard delete**: רק דרך endpoint מיוחד עם permission מתאים
- **Cascade**: מוגדר ברמת ה-schema (Prisma)

---

## 5. אבטחה והרשאות

### 5.1 Authentication

#### JWT (לממשק משתמש)
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
- **Expiry**: 24 שעות (access), 7 ימים (refresh)
- **Refresh**: `POST /auth/refresh`

#### API Key (לאינטגרציות)
```http
X-API-Key: haitech_live_abc123...
```
- **Format**: `haitech_{env}_{random}`
- **Scopes**: מוגבל לפעולות ספציפיות

### 5.2 Authorization (RBAC)

| Role | הרשאות |
|------|--------|
| **admin** | הכל |
| **manager** | CRUD על כל האובייקטים חוץ מ-Users |
| **instructor** | קריאה + עדכון פגישות/נוכחות שלו בלבד |
| **api_integration** | לפי scopes של ה-API Key |

### 5.3 Rate Limiting
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1612137600
```
- **Default**: 1000 requests/hour
- **Per endpoint**: ניתן להגדיר בנפרד
- **Burst**: 100 requests/minute

### 5.4 Audit Log
כל פעולת כתיבה מתועדת:
```json
{
  "userId": "uuid",
  "action": "UPDATE",
  "entity": "Meeting",
  "entityId": "uuid",
  "oldValue": { "status": "scheduled" },
  "newValue": { "status": "completed" },
  "ipAddress": "1.2.3.4",
  "timestamp": "2026-02-06T12:00:00Z"
}
```

---

## 6. Idempotency

### 6.1 מנגנון
```http
POST /customers
Idempotency-Key: unique-request-id-123
```

- שמירת תוצאה ל-24 שעות
- אם אותו key נשלח שוב → מחזיר תוצאה שמורה
- חובה עבור: POST, PUT, DELETE

### 6.2 Retry Strategy
```
Retry-After: 5
```
- **5xx errors**: retry עם exponential backoff
- **4xx errors**: לא לעשות retry (למעט 429)
- **429 (Rate Limit)**: המתן לפי `Retry-After`

---

## 7. Webhooks

### 7.1 אירועים נתמכים

| Event | Trigger |
|-------|---------|
| `customer.created` | לקוח חדש |
| `customer.updated` | עדכון לקוח |
| `student.created` | תלמיד חדש |
| `registration.created` | הרשמה חדשה |
| `registration.paid` | תשלום התקבל |
| `meeting.completed` | פגישה הסתיימה |
| `meeting.cancelled` | פגישה בוטלה |
| `cycle.created` | מחזור חדש |
| `cycle.completed` | מחזור הסתיים |

### 7.2 מבנה Webhook
```json
{
  "id": "evt_123",
  "type": "meeting.completed",
  "timestamp": "2026-02-06T12:00:00Z",
  "data": {
    "id": "meeting-uuid",
    "cycleId": "cycle-uuid",
    ...
  }
}
```

### 7.3 אימות (HMAC)
```http
X-Webhook-Signature: sha256=abc123...
```
```javascript
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(JSON.stringify(payload))
  .digest('hex');
```

### 7.4 Retry Policy
- **Attempts**: 5
- **Backoff**: 1min, 5min, 30min, 2h, 24h
- **Dead Letter**: שמירה לטיפול ידני

---

## 8. Error Codes

| Code | HTTP | תיאור |
|------|------|-------|
| `UNAUTHORIZED` | 401 | לא מאומת |
| `FORBIDDEN` | 403 | אין הרשאה |
| `NOT_FOUND` | 404 | לא נמצא |
| `VALIDATION_ERROR` | 400 | קלט לא תקין |
| `CONFLICT` | 409 | כפילות / conflict |
| `RATE_LIMITED` | 429 | חריגה ממגבלות |
| `INTERNAL_ERROR` | 500 | שגיאה פנימית |

---

## 9. Versioning

- **URL-based**: `/api/v1/`, `/api/v2/`
- **Deprecation**: הודעה 6 חודשים מראש
- **Sunset header**: `Sunset: Sat, 01 Jan 2027 00:00:00 GMT`

---

## 10. שאלות לבירור

לפני התחלת המימוש, צריך לברר:

1. **API Keys Management** - האם נבנה UI לניהול מפתחות או רק CLI/DB?
2. **Webhook Registration** - האם לקוחות יכולים לרשום webhooks בעצמם?
3. **Multi-tenant** - האם יש צורך לתמוך במספר ארגונים?
4. **Rate Limits** - מה הגבולות הנדרשים בפועל?
5. **Data Export** - האם נדרש API לייצוא מלא (GDPR)?
6. **Real-time** - האם נדרש WebSocket לעדכונים בזמן אמת?

---

*מסמך זה מהווה בסיס לתכנון. ראה קבצים נוספים:*
- `ENDPOINTS.md` - טבלת endpoints מלאה
- `WORK_PLAN.md` - תכנית עבודה מפורטת
- `openapi/` - OpenAPI specifications
