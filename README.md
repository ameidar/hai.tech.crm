# HaiTech CRM 🎓

מערכת CRM מותאמת אישית לניהול עסק חוגי תכנות של **HaiTech** — ניהול מחזורים, מפגשים, תלמידים, מדריכים, סניפים, הוצאות ועוד.

> **Production:** https://crm.orma-ai.com  
> **Development:** http://129.159.133.209:3002/

---

## 📋 תוכן עניינים

- [סקירה כללית](#-סקירה-כללית)
- [ארכיטקטורה](#-ארכיטקטורה)
- [Stack טכנולוגי](#-stack-טכנולוגי)
- [התקנה והרצה](#-התקנה-והרצה)
- [פקודות Docker](#-פקודות-docker)
- [משתני סביבה](#-משתני-סביבה)
- [API Endpoints](#-api-endpoints)
- [מודל הנתונים](#-מודל-הנתונים)
- [תהליך פיתוח](#-תהליך-פיתוח)
- [מיגרציה מ-Fireberry](#-מיגרציה-מ-fireberry)

---

## 🔍 סקירה כללית

המערכת מחליפה את Fireberry CRM ומספקת:

- **ניהול מחזורים (Cycles)** — מחזורי לימוד עם סוגי תמחור שונים (פרטי, מוסדי לפי ילד, מוסדי קבוע)
- **ניהול מפגשים (Meetings)** — לו"ז, נוכחות, סטטוס, הקלטות Zoom
- **ניהול תלמידים ולקוחות** — רישום, מעקב תשלומים, היסטוריה
- **ניהול מדריכים** — תעריפים, שיוך למחזורים, פורטל מדריך עם magic link
- **ניהול סניפים** — בתי ספר, מתנ"סים, אונליין, פרונטלי
- **הזמנות מוסדיות** — חוזים, תמחור לפי מפגש, מעקב
- **מעקב הוצאות** — הוצאות ברמת מחזור ומפגש (נסיעות, חומרים, מדריך נוסף)
- **אינטגרציית Zoom** — יצירת פגישות אוטומטית, webhooks, הקלטות
- **הודעות WhatsApp** — דרך Green API
- **שליחת מיילים** — דרך Gmail (info@hai.tech)
- **תמלול ו-AI** — סיכום שיעורים עם OpenAI
- **Dashboard ודוחות** — סטטיסטיקות, תצוגות שמורות, audit log
- **פורטל מדריכים** — גישה מוגבלת למדריכים דרך invite/magic link

---

## 🏗 ארכיטקטורה

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────┐
│   Frontend      │────▶│   Backend API   │────▶│  PostgreSQL  │
│   React + Vite  │     │   Express.js    │     │  (Prisma)    │
│   Port 5173     │     │   Port 3001/2   │     │  Port 5432   │
└─────────────────┘     └────────┬────────┘     └──────────────┘
                                 │
                        ┌────────┴────────┐
                        │     Redis       │
                        │   (BullMQ)      │
                        │   Port 6379     │
                        └─────────────────┘
```

**Production:** ה-Frontend מוגש כ-static files מתוך ה-Backend (תיקיית `frontend-dist/`).  
**Development:** ה-Frontend רץ בנפרד על port 5173 עם Vite dev server.

---

## 🛠 Stack טכנולוגי

### Backend
| טכנולוגיה | שימוש |
|-----------|-------|
| **Node.js + TypeScript** | שרת API |
| **Express.js** | HTTP framework |
| **Prisma ORM** | גישה ל-database |
| **PostgreSQL 16** | בסיס נתונים |
| **Redis 7** | תורים (BullMQ), cache |
| **Zod** | validation של schemas |
| **JWT** | אימות משתמשים (access + refresh tokens) |
| **bcrypt** | הצפנת סיסמאות |
| **nodemailer** | שליחת מיילים |
| **node-cron** | משימות מתוזמנות |
| **OpenAI** | תמלול וסיכום שיעורים |
| **Vitest** | בדיקות |

### Frontend
| טכנולוגיה | שימוש |
|-----------|-------|
| **React 19** | UI framework |
| **Vite 7** | build tool + dev server |
| **TypeScript** | type safety |
| **TailwindCSS 4** | עיצוב |
| **React Router 7** | ניווט |
| **TanStack React Query** | ניהול state של API |
| **React Hook Form + Zod** | טפסים ו-validation |
| **Recharts** | גרפים ותרשימים |
| **Lucide React** | אייקונים |

### Infrastructure
| טכנולוגיה | שימוש |
|-----------|-------|
| **Docker + Docker Compose** | containerization |
| **Helmet** | אבטחת HTTP headers |
| **express-rate-limit** | הגנה מ-brute force |

---

## 🚀 התקנה והרצה

### דרישות מקדימות
- Node.js >= 18
- Docker + Docker Compose
- Git

### הרצה עם Docker (מומלץ)

```bash
# Clone
git clone <repo-url> haitech-crm
cd haitech-crm

# צור קובץ .env בתיקיית backend
cp backend/.env.example backend/.env
# ערוך את המשתנים לפי הצורך

# הרצת כל השירותים (production)
docker compose up -d

# הרצת סביבת development
docker compose -f docker-compose.dev.yml up -d
```

### הרצה מקומית (ללא Docker)

```bash
# Backend
cd backend
npm install
npx prisma generate
npx prisma db push
npm run db:seed       # יוצר admin user
npm run dev           # רץ על port 3001

# Frontend (terminal נפרד)
cd frontend
npm install
npm run dev           # רץ על port 5173
```

### כניסה ראשונה
- **URL:** https://crm.orma-ai.com (או localhost)
- **Email:** `admin@haitech.co.il`
- **Password:** `admin123`

---

## 🐳 פקודות Docker

### Containers
| Container | תיאור | Port |
|-----------|--------|------|
| `haitech-api` | Backend API (production) | 3001 |
| `haitech-api-dev` | Backend API (development) | 3002 |
| `haitech-db` | PostgreSQL 16 | 5432 |
| `haitech-redis` | Redis 7 | 6379 |

### פקודות שימושיות

```bash
# הרצה/עצירה
docker compose up -d                    # הפעלה
docker compose down                     # עצירה
docker compose restart api              # restart ל-API בלבד

# לוגים
docker logs -f haitech-api              # לוגים של production API
docker logs -f haitech-api-dev          # לוגים של dev API
docker logs -f haitech-db               # לוגים של DB

# Build מחדש
docker compose build --no-cache api     # build מחדש
docker compose up -d --build            # build + הפעלה

# גישה ל-database
docker exec -it haitech-db psql -U haitech -d haitech_crm

# גישה ל-Redis
docker exec -it haitech-redis redis-cli

# Prisma Studio (GUI לבסיס הנתונים)
cd backend && npx prisma studio
```

### Deploy (production)

```bash
# Build frontend
cd frontend && npm run build
# העתקת dist ל-backend
cp -r dist ../backend/frontend-dist

# Build + deploy
cd .. && docker compose up -d --build api
```

---

## 🔐 משתני סביבה

קובץ `backend/.env`:

| משתנה | תיאור | דוגמה |
|-------|--------|-------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://haitech:pass@localhost:5432/haitech_crm` |
| `PORT` | פורט ה-API | `3001` |
| `NODE_ENV` | סביבה | `production` / `development` |
| `JWT_SECRET` | מפתח חתימת JWT | (מחרוזת אקראית) |
| `JWT_REFRESH_SECRET` | מפתח refresh token | (מחרוזת אקראית) |
| `JWT_EXPIRES_IN` | תוקף access token | `1d` |
| `JWT_REFRESH_EXPIRES_IN` | תוקף refresh token | `7d` |
| `REDIS_HOST` | כתובת Redis | `redis` / `localhost` |
| `REDIS_PORT` | פורט Redis | `6379` |
| `FRONTEND_URL` | כתובת ה-Frontend | `https://crm.orma-ai.com` |
| `API_KEY` | מפתח API חיצוני | (מחרוזת) |
| `ZOOM_ACCOUNT_ID` | Zoom OAuth | (מ-Zoom marketplace) |
| `ZOOM_CLIENT_ID` | Zoom OAuth | (מ-Zoom marketplace) |
| `ZOOM_CLIENT_SECRET` | Zoom OAuth | (מ-Zoom marketplace) |
| `ZOOM_SECRET_TOKEN` | Zoom webhook verification | (מ-Zoom marketplace) |
| `ZOOM_WEBHOOK_URL` | Webhook URL ל-Make.com | `https://hook.eu1.make.com/...` |
| `GREEN_API_INSTANCE_ID` | Green API (WhatsApp) | (מ-Green API) |
| `GREEN_API_TOKEN` | Green API token | (מ-Green API) |
| `GMAIL_USER` | כתובת Gmail לשליחה | `info@hai.tech` |
| `GMAIL_PASS` | App password של Gmail | (מ-Google) |
| `OPENAI_API_KEY` | מפתח OpenAI | `sk-...` |

---

## 📡 API Endpoints

כל ה-endpoints נמצאים תחת `/api/`. נדרש JWT token ב-header (למעט auth ו-public routes).

### Authentication
| Method | Endpoint | תיאור |
|--------|----------|--------|
| POST | `/api/auth/login` | התחברות |
| POST | `/api/auth/refresh` | חידוש token |
| POST | `/api/auth/reset-password` | איפוס סיסמה |

### Cycles (מחזורים)
| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/cycles` | רשימת מחזורים (עם filters, pagination) |
| GET | `/api/cycles/:id` | פרטי מחזור |
| POST | `/api/cycles` | יצירת מחזור חדש |
| PUT | `/api/cycles/:id` | עדכון מחזור |
| DELETE | `/api/cycles/:id` | מחיקת מחזור (soft delete) |

### Meetings (מפגשים)
| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/meetings` | רשימת מפגשים |
| GET | `/api/meetings/:id` | פרטי מפגש |
| POST | `/api/meetings` | יצירת מפגש |
| PUT | `/api/meetings/:id` | עדכון מפגש |
| PATCH | `/api/meetings/:id/status` | עדכון סטטוס |
| DELETE | `/api/meetings/:id` | מחיקת מפגש |

### Customers (לקוחות)
| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/customers` | רשימת לקוחות |
| GET | `/api/customers/:id` | פרטי לקוח |
| POST | `/api/customers` | יצירת לקוח |
| PUT | `/api/customers/:id` | עדכון לקוח |
| DELETE | `/api/customers/:id` | מחיקת לקוח |

### Students (תלמידים)
| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/students` | רשימת תלמידים |
| POST | `/api/students` | יצירת תלמיד |
| PUT | `/api/students/:id` | עדכון תלמיד |
| DELETE | `/api/students/:id` | מחיקת תלמיד |

### Instructors (מדריכים)
| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/instructors` | רשימת מדריכים |
| POST | `/api/instructors` | יצירת מדריך |
| PUT | `/api/instructors/:id` | עדכון מדריך |
| POST | `/api/instructors/:id/invite` | שליחת invite link |

### Registrations (רישומים)
| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/registrations` | רשימת רישומים |
| POST | `/api/registrations` | רישום תלמיד למחזור |
| PUT | `/api/registrations/:id` | עדכון רישום |
| DELETE | `/api/registrations/:id` | ביטול רישום |

### Branches (סניפים)
| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/branches` | רשימת סניפים |
| POST | `/api/branches` | יצירת סניף |
| PUT | `/api/branches/:id` | עדכון סניף |

### Courses (קורסים)
| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/courses` | רשימת קורסים |
| POST | `/api/courses` | יצירת קורס |
| PUT | `/api/courses/:id` | עדכון קורס |

### Attendance (נוכחות)
| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/attendance/:meetingId` | נוכחות למפגש |
| POST | `/api/attendance` | רישום נוכחות |

### Expenses (הוצאות)
| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/expenses/cycle/:cycleId` | הוצאות מחזור |
| POST | `/api/expenses/cycle` | הוספת הוצאת מחזור |
| POST | `/api/expenses/meeting` | הוספת הוצאת מפגש |

### נוספים
| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/views` | תצוגות שמורות |
| GET | `/api/audit` | לוג פעולות |
| POST | `/api/email/send` | שליחת מייל |
| POST | `/api/messaging/send` | שליחת WhatsApp |
| POST | `/api/zoom/create` | יצירת פגישת Zoom |
| POST | `/api/zoom-webhook` | Zoom webhook receiver |
| GET | `/api/public-meeting/:token` | דף מפגש ציבורי (למדריכים) |
| GET | `/api/instructor-magic/:token` | כניסת מדריך עם magic link |
| GET | `/api/invite/:token` | הגדרת סיסמה למדריך חדש |
| GET | `/api/health` | Health check |

---

## 📊 מודל הנתונים

### ישויות עיקריות

```
Customer ──┬── Student ──── Registration ──── Attendance
           │                    │
           │                    ▼
Course ────┴── Cycle ──────── Meeting ──────── MeetingExpense
                │                │
                ├── CycleExpense │
                │                ▼
Branch ─────────┘           Instructor
                                │
InstitutionalOrder ─────────────┘

User (admin/manager/instructor)
AuditLog, SavedView
```

### סוגי מחזור (CycleType)
- **private** — שיעור פרטי, תמחור לפי תלמיד
- **institutional_per_child** — מוסדי, תמחור לפי ילד
- **institutional_fixed** — מוסדי, מחיר קבוע למפגש

### סוגי סניף (BranchType)
- school, community_center, frontal, online

### סוגי פעילות (ActivityType)
- online, frontal, private

### תפקידי משתמש (UserRole)
- admin, manager, instructor

---

## 💻 תהליך פיתוח

### מבנה תיקיות

```
haitech-crm/
├── backend/
│   ├── src/
│   │   ├── routes/          # Express route handlers
│   │   ├── services/        # Business logic (email, zoom, messaging)
│   │   ├── middleware/       # Auth, validation, error handling
│   │   ├── utils/            # Helpers
│   │   ├── types/            # TypeScript types
│   │   ├── config.ts         # App configuration
│   │   └── index.ts          # Entry point
│   ├── prisma/
│   │   ├── schema.prisma     # Database schema
│   │   ├── migrations/       # Migration files
│   │   └── seed.ts           # Seed data
│   ├── scripts/              # Import/migration scripts
│   ├── tests/                # Vitest tests
│   ├── frontend-dist/        # Built frontend (served in production)
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/            # Page components
│   │   ├── components/       # Shared components
│   │   ├── hooks/            # Custom React hooks
│   │   ├── api/              # API client (axios)
│   │   ├── context/          # React context (auth, etc.)
│   │   ├── types/            # TypeScript types
│   │   ├── App.tsx           # Root component + routing
│   │   └── main.tsx          # Entry point
│   ├── vite.config.ts
│   └── package.json
├── migration/                # Fireberry migration scripts & data
├── docker-compose.yml        # Production
├── docker-compose.dev.yml    # Development
└── README.md
```

### Workflow

```bash
# 1. פיתוח מקומי
cd backend && npm run dev     # API עם hot reload (tsx watch)
cd frontend && npm run dev    # Vite dev server

# 2. שינויי database
cd backend
npx prisma migrate dev --name <migration-name>
npx prisma generate

# 3. בדיקות
cd backend && npm test

# 4. Build + Deploy
cd frontend && npm run build
cp -r dist ../backend/frontend-dist
cd ../
docker compose up -d --build api

# 5. Prisma Studio (GUI)
cd backend && npx prisma studio
```

---

## 🔄 מיגרציה מ-Fireberry

בתאריך **01.02.2026** בוצעה מיגרציה מ-Fireberry CRM:
- הועברו **127 מחזורים** עם כל הנתונים המשויכים
- סקריפטי המיגרציה נמצאים בתיקיית `migration/`
- כל מחזור שמיגר שומר את ה-`fireberryId` המקורי לצורך מעקב
- דוח מיגרציה מפורט: `migration/MIGRATION_REPORT.md`

### קבצי מיגרציה
- `export-fireberry.sh` — ייצוא נתונים מ-Fireberry API
- `migrate_cycles.mjs` / `migrate_cycles_v2.mjs` — סקריפטי מיגרציה
- `import_students_registrations.js` — ייבוא תלמידים ורישומים
- `import_csv_cycles.js` — ייבוא מ-CSV
- `fix_all.mjs` — תיקונים לאחר מיגרציה

---

## 📝 הערות נוספות

- המערכת תומכת ב-**RTL** (עברית) בצד ה-Frontend
- **Soft delete** — רוב הישויות תומכות במחיקה רכה (`deletedAt`)
- **Audit log** — כל פעולת CRUD נרשמת עם פרטי המשתמש
- **Saved Views** — משתמשים יכולים לשמור תצוגות מסוננות מותאמות אישית
- **Rate limiting** — הגנה מפני brute force על auth endpoints
- קטגוריות קורסים: תכנות, AI, רובוטיקה, הדפסת 3D

---

*נבנה עבור HaiTech — חינוך טכנולוגי לילדים 🚀*
