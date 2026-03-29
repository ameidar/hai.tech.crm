# HaiTech CRM - מסמך תכנון

## סקירה כללית
מערכת CRM מותאמת לניהול פעילות דרך ההייטק - הדרכות תכנות ובינה מלאכותית לילדים, נוער וארגונים.

---

## ישויות עיקריות (Entities)

### 1. לקוחות (Customers)
```
Customer {
  id: UUID (PK)
  name: string                    // שם ההורה/איש קשר
  email: string
  phone: string (unique)
  address?: string
  city?: string
  created_at: timestamp
  notes?: text
}
```

### 2. תלמידים (Students)
```
Student {
  id: UUID (PK)
  customer_id: FK → Customer
  name: string                    // שם הילד
  birth_date?: date
  grade?: string                  // כיתה
  notes?: text
}
```

### 3. קורסים (Courses)
```
Course {
  id: UUID (PK)
  name: string                    // מיינקראפט JavaScript, פיתוח משחקים AI
  description?: text
  target_audience?: string        // כיתות ג-ד, כיתות ה-ו
  category: enum                  // programming, ai, robotics, 3d_printing
  is_active: boolean
  created_at: timestamp
}
```

### 4. סניפים (Branches)
```
Branch {
  id: UUID (PK)
  name: string                    // בית ספר בן גוריון, עומר פרונטלי
  type: enum                      // school, community_center, frontal, online
  address?: string
  city?: string
  
  // איש קשר
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  
  is_active: boolean
  created_at: timestamp
}
```

### 5. הזמנות מוסדיות (Institutional Orders)
```
InstitutionalOrder {
  id: UUID (PK)
  branch_id: FK → Branch
  
  // פרטי הזמנה
  order_number?: string
  order_date: date
  start_date: date
  end_date: date
  
  // תמחור
  price_per_meeting: decimal
  estimated_meetings: integer
  estimated_total: decimal
  
  // איש קשר
  contact_name: string
  contact_phone: string
  contact_email?: string
  
  // מסמכים
  contract_file?: string          // לינק לקובץ חוזה
  
  status: enum                    // draft, active, completed, cancelled
  notes?: text
  created_at: timestamp
}
```

### 6. מחזורים (Cycles)
```
Cycle {
  id: UUID (PK)
  name: string
  course_id: FK → Course
  branch_id: FK → Branch
  instructor_id: FK → Instructor
  institutional_order_id?: FK → InstitutionalOrder  // null אם פרטי
  
  // סוג מחזור
  type: enum                      // institutional, private
  
  // תאריכים
  start_date: date
  end_date: date
  
  // לוח זמנים
  day_of_week: enum               // sunday, monday, tuesday, wednesday, thursday, friday, saturday
  start_time: time
  end_time: time
  duration_minutes: integer
  total_meetings: integer         // מספר מפגשים מתוכנן
  
  // כספים - מחזור פרטי
  price_per_student?: decimal
  
  // הגדרות
  max_students?: integer
  send_parent_reminders: boolean  // האם לשלוח תזכורות להורים
  is_online: boolean              // האם מחזור אונליין (Zoom)
  
  // ספירה (computed)
  completed_meetings: integer     // מפגשים שהתקיימו
  remaining_meetings: integer     // מפגשים שנותרו
  
  status: enum                    // active, completed, cancelled
  created_at: timestamp
}
```

### 7. מדריכים (Instructors)
```
Instructor {
  id: UUID (PK)
  name: string
  phone: string (unique)
  email: string
  
  // תעריפים
  rate_frontal: decimal           // תעריף שעתי פרונטלי
  rate_online: decimal            // תעריף שעתי אונליין
  rate_preparation: decimal       // תעריף הכנת חומרים/תמיכה
  
  // הרשאות
  user_id?: FK → User             // לכניסה למערכת
  
  is_active: boolean
  notes?: text
  created_at: timestamp
}
```

### 8. הרשמות (Registrations)
```
Registration {
  id: UUID (PK)
  student_id: FK → Student
  cycle_id: FK → Cycle
  
  registration_date: date
  status: enum                    // registered, active, completed, cancelled
  
  // תשלום (רק למחזור פרטי)
  amount?: decimal
  payment_status?: enum           // unpaid, partial, paid
  payment_method?: enum           // credit, transfer, cash
  invoice_link?: string           // לינק חשבונית ירוקה
  
  cancellation_date?: date
  cancellation_reason?: string
  
  notes?: text
  created_at: timestamp
}
```

### 9. פגישות/שיעורים (Meetings)
```
Meeting {
  id: UUID (PK)
  cycle_id: FK → Cycle
  instructor_id: FK → Instructor  // יכול להיות שונה (מחליף)
  
  // תזמון
  scheduled_date: date
  start_time: time
  end_time: time
  
  // סטטוס
  status: enum                    // scheduled, completed, cancelled, postponed
  status_updated_at?: timestamp
  status_updated_by?: FK → User
  
  // כספים (מחושב)
  revenue: decimal                // הכנסה
  instructor_payment: decimal     // תשלום למדריך
  profit: decimal                 // רווח
  
  // פרטים
  topic?: string                  // נושא השיעור
  notes?: text                    // הערות המדריך
  
  // Zoom (אם אונליין)
  zoom_meeting_id?: string
  zoom_join_url?: string
  zoom_start_url?: string
  
  // אם נדחה - לאיזו פגישה
  rescheduled_to_id?: FK → Meeting
  
  created_at: timestamp
}
```

### 10. נוכחות (Attendance)
```
Attendance {
  id: UUID (PK)
  meeting_id: FK → Meeting
  registration_id: FK → Registration
  
  status: enum                    // present, absent, late
  notes?: string
  
  recorded_at: timestamp
  recorded_by: FK → User
}
```

### 11. משתמשים (Users)
```
User {
  id: UUID (PK)
  email: string (unique)
  password_hash: string
  name: string
  phone?: string
  
  role: enum                      // admin, manager, instructor
  
  is_active: boolean
  last_login?: timestamp
  created_at: timestamp
}
```

---

## תהליכים עיקריים

### 1. תהליך דיווח שיעור (מדריך)

```
מדריך פותח פגישה של היום
    ↓
רואה רשימת נרשמים (סטטוס = נרשם)
    ↓
ממלא נוכחות לכל תלמיד
    ↓
מסמן סטטוס פגישה:
    • התקיימה → נספרת כ-completed_meetings
    • נדחתה → נוצרת פגישה חדשה אוטומטית
    • בוטלה → לא נספרת
    ↓
מוסיף הערות/נושא (אופציונלי)
    ↓
remaining_meetings מתעדכן
```

**חוקים:**
- מדריך יכול לעדכן סטטוס רק ביום הפגישה
- לא ניתן לשנות סטטוס של פגישות עבר/עתיד
- פגישה "נדחתה" יוצרת פגישה חדשה אחרי הפגישה האחרונה במחזור

### 2. תהליך גבייה מוסדית (סוף חודש)

```
1 בחודש: הרצת job אוטומטי
    ↓
לכל סניף מוסדי:
    - ספירת פגישות שהתקיימו בחודש הקודם
    - חישוב עלות (פגישות × מחיר לפגישה)
    - חישוב עלויות מדריכים
    ↓
יצירת דוח גבייה
    ↓
שליחת דוח לאינה בוואטסאפ
    ↓
אישור ידני
    ↓
שליחה למוסד / יצירת חשבונית
```

### 3. תהליך תזכורות

```
יום לפני פגישה:
    - תזכורת למדריך (תמיד)
    - תזכורת להורים (אם cycle.send_parent_reminders = true)

שעה לפני:
    - תזכורת למדריך
```

---

## ממשק משתמש

### 1. ממשק ניהול (Admin/Manager)

#### דשבורד ראשי
- פגישות היום
- פגישות ללא סטטוס (תזכורת)
- התראות דחופות
- סיכום שבועי: הכנסות, הוצאות, רווח

#### ניהול ישויות
- לקוחות ותלמידים (CRUD)
- קורסים (CRUD)
- מחזורים (CRUD + ייצור פגישות אוטומטי)
- מדריכים (CRUD)
- סניפים והזמנות מוסדיות (CRUD)

#### לוח שנה
- תצוגה יומית/שבועית/חודשית
- סינון לפי מדריך/סניף
- גרירה ושחרור לשינוי זמנים

#### דוחות
- דוח יומי: פגישות, סטטוסים, הערות
- דוח שבועי: הכנסה, הוצאה, רווח
- דוח חודשי: סיכום + גבייה מוסדית
- דוח לפי סניף
- דוח לפי מדריך

### 2. ממשק מדריכים (Instructor Portal)

#### דף ראשי
- הפגישות שלי היום
- הפגישות שלי השבוע
- פגישות שממתינות לדיווח

#### דף פגישה
- פרטי הפגישה (מחזור, שעה, מיקום)
- רשימת נרשמים + מילוי נוכחות
- בחירת סטטוס (רק ביום הפגישה)
- הוספת הערות/נושא
- כפתור "נדחתה" עם בחירת תאריך חדש

#### היסטוריה
- רשימת פגישות קודמות (read-only)

---

## API Endpoints

### Authentication
```
POST   /api/auth/login          // התחברות
POST   /api/auth/logout         // התנתקות
GET    /api/auth/me             // פרטי משתמש נוכחי
```

### Customers & Students
```
GET    /api/customers                    // רשימת לקוחות
POST   /api/customers                    // יצירת לקוח
GET    /api/customers/:id                // לקוח בודד
PUT    /api/customers/:id                // עדכון לקוח
GET    /api/customers/:id/students       // תלמידים של לקוח
POST   /api/customers/:id/students       // הוספת תלמיד
```

### Courses
```
GET    /api/courses                      // רשימת קורסים
POST   /api/courses                      // יצירת קורס
GET    /api/courses/:id                  // קורס בודד
PUT    /api/courses/:id                  // עדכון קורס
```

### Branches & Institutional Orders
```
GET    /api/branches                     // רשימת סניפים
POST   /api/branches                     // יצירת סניף
GET    /api/branches/:id                 // סניף בודד
GET    /api/branches/:id/orders          // הזמנות מוסדיות
POST   /api/branches/:id/orders          // יצירת הזמנה
GET    /api/branches/:id/cycles          // מחזורים בסניף
```

### Cycles
```
GET    /api/cycles                       // רשימת מחזורים
POST   /api/cycles                       // יצירת מחזור (+ יצירת פגישות)
GET    /api/cycles/:id                   // מחזור בודד
PUT    /api/cycles/:id                   // עדכון מחזור
GET    /api/cycles/:id/meetings          // פגישות במחזור
GET    /api/cycles/:id/registrations     // הרשמות במחזור
POST   /api/cycles/:id/registrations     // הוספת הרשמה
```

### Meetings
```
GET    /api/meetings                     // רשימת פגישות
GET    /api/meetings?date=2026-01-30     // פגישות לתאריך
GET    /api/meetings?from=...&to=...     // פגישות בטווח
GET    /api/meetings/:id                 // פגישה בודדת
PUT    /api/meetings/:id                 // עדכון פגישה
POST   /api/meetings/:id/postpone        // דחיית פגישה
GET    /api/meetings/:id/attendance      // נוכחות בפגישה
POST   /api/meetings/:id/attendance      // מילוי נוכחות
```

### Instructors
```
GET    /api/instructors                  // רשימת מדריכים
POST   /api/instructors                  // יצירת מדריך
GET    /api/instructors/:id              // מדריך בודד
PUT    /api/instructors/:id              // עדכון מדריך
GET    /api/instructors/:id/meetings     // פגישות של מדריך
GET    /api/instructors/:id/schedule     // לוח זמנים
```

### Reports
```
GET    /api/reports/daily?date=...                    // דוח יומי
GET    /api/reports/weekly?week=...                   // דוח שבועי
GET    /api/reports/monthly?month=...                 // דוח חודשי
GET    /api/reports/branch/:id?month=...              // דוח סניף
GET    /api/reports/instructor/:id?month=...          // דוח מדריך
GET    /api/reports/billing?month=...                 // דוח גבייה מוסדית
```

### Notifications
```
POST   /api/notifications/send           // שליחת הודעה
POST   /api/notifications/reminder       // תזכורת ידנית
GET    /api/notifications/log            // היסטוריית הודעות
```

---

## אינטגרציות

### 1. Green API (WhatsApp)
**שימושים:**
- תזכורות למדריכים (יום לפני, שעה לפני)
- תזכורות להורים (אם מוגדר במחזור)
- דוחות לאינה/אריאל
- התראות על ביטולים/שינויים

**פורמט הודעות:**
```
תזכורת למדריך:
"שלום [שם], תזכורת לשיעור מחר:
📍 [שם מחזור]
🕐 [שעה]
👥 [מספר תלמידים] תלמידים"

תזכורת להורה:
"שלום, תזכורת לשיעור של [שם ילד] מחר:
📍 [שם מחזור]
🕐 [שעה]"
```

### 2. חשבונית ירוקה
- שמירת לינק חשבונית בהרשמה
- אופציונלי: webhook לעדכון סטטוס תשלום

### 3. Zoom API
**שימוש:** יצירת לינקי Zoom אוטומטית לשיעורים אונליין

**תהליך:**
- כשנוצרת פגישה במחזור אונליין → יצירת Zoom meeting
- שמירת לינק ב-Meeting record
- הלינק נשלח בתזכורות

**שדות נוספים ב-Meeting:**
```
zoom_meeting_id?: string
zoom_join_url?: string
zoom_start_url?: string
```

**שדות נוספים ב-Cycle:**
```
is_online: boolean           // האם מחזור אונליין
zoom_host_id?: string        // מי המארח (אם קבוע)
```

### 4. אחסון קבצים
- חוזים/הסכמים מוסדיים
- אופציונלי: S3/MinIO או Google Drive

---

## טכנולוגיה

### Backend
```
Framework:    Node.js + Express / NestJS
              או Python + FastAPI
Database:     PostgreSQL
ORM:          Prisma / TypeORM / SQLAlchemy
Cache:        Redis (אופציונלי)
Queue:        Bull (לתזכורות ודוחות)
```

### Frontend
```
Framework:    React + TypeScript
              או Next.js
UI Library:   Tailwind CSS + Headless UI
              או Shadcn/ui
Calendar:     FullCalendar או react-big-calendar
Forms:        React Hook Form + Zod
State:        React Query + Zustand
```

### Infrastructure
```
Server:       Oracle Cloud (קיים)
Container:    Docker + Docker Compose
Reverse Proxy: Nginx / Caddy
SSL:          Let's Encrypt
CI/CD:        GitHub Actions
```

### Security
```
Auth:         JWT + Refresh tokens
Passwords:    bcrypt
HTTPS:        חובה
RBAC:         Role-based access control
Rate Limit:   למניעת spam
```

---

## שלבי פיתוח - סטטוס מימוש

### Phase 1: Foundation ✅ COMPLETED
- [x] הגדרת DB schema (Prisma - 18 מודלים)
- [x] הקמת Backend בסיסי + API (Express + TypeScript)
- [x] Auth system (JWT + refresh tokens)
- [x] CRUD לישויות עיקריות (25 routes)

### Phase 2: Core Features ✅ COMPLETED
- [x] ממשק ניהול בסיסי (21 עמודים ב-React)
- [x] ניהול מחזורים ויצירת פגישות אוטומטית
- [x] מנגנון דיווח פגישה (מדריכים)
- [x] מנגנון נוכחות

### Phase 3: Automation ✅ COMPLETED
- [x] אינטגרציית Green API (WhatsApp)
- [x] תזכורות אוטומטיות למדריכים
- [x] חישוב כספים אוטומטי (הכנסות, הוצאות, רווח)
- [x] דוחות גבייה מוסדית
- [x] **אינטגרציית Zoom** (יצירה אוטומטית למחזורים אונליין)

### Phase 4: Polish ✅ COMPLETED
- [x] דוחות מתקדמים + תחזיות (ForecastChart)
- [x] ממשק מדריכים (Desktop + Mobile)
- [x] מיגרציה מפיירברי (~127 מחזורים)
- [x] **מערכת הוצאות** (CycleExpense, MeetingExpense)
- [x] **Custom Views** (תצוגות מותאמות)
- [x] **Audit Log** (מעקב שינויים)

### Phase 5: Testing 🔄 IN PROGRESS
- [x] E2E tests setup (Playwright)
- [x] Smoke tests
- [x] Auth, Cycles, Expenses, Meetings, Reports tests
- [ ] Full coverage for all entities

---

## מיגרציה מפיירברי ✅ COMPLETED

### ישויות שהועברו:
1. ✅ לקוחות (accounts) → Customers (חלקי - למחזורים פרטיים)
2. ✅ הרשמות (33) → Registrations + Students (חלקי)
3. ✅ מחזורים (1000) → Cycles (~127 מחזורים פעילים)
4. ✅ מדריכים (1002) → Instructors (~12 מדריכים)
5. ✅ פגישות (6) → Meetings (נוצרו אוטומטית)
6. ✅ סניפים → Branches (~40 סניפים)

### תהליך שבוצע:
1. ✅ מיפוי שדות Fireberry → שדות חדשים
2. ✅ סקריפט export מ-Fireberry API
3. ✅ סקריפט import ל-PostgreSQL
4. ✅ validation והשוואה
5. ✅ המערכת בפרודקשן

---

## החלטות

1. **קבוצות WhatsApp:** יצירה ידנית (לא אוטומטית)
2. **Admin vs Manager:** Admin יכול לשנות, Manager רק צופה
3. **מדריך מחליף:** אריאל מטפלת - משנה פגישה ספציפית או יוצרת מחזור חדש
4. **שם המערכת:** HaiTech CRM
5. **Zoom:** יצירה אוטומטית למחזורים אונליין עם webhook לתמלולים

---

## תוספות שלא היו בתכנון המקורי

### מערכת הוצאות (Expenses)
- **CycleExpense**: הוצאות חוזרות ברמת מחזור (חומרים, שעות מעטפת, ציוד)
- **MeetingExpense**: הוצאות חד-פעמיות ברמת פגישה (נסיעות, מונית, מדריך נוסף)

### תחזיות פיננסיות (Forecast)
- גרף תחזית הכנסות והוצאות
- חישוב צפי רווח
- ניתוח לפי חודשים

### Custom Views
- שמירת תצוגות מותאמות אישית
- סינונים מתקדמים
- בחירת עמודות

### Audit Log
- מעקב אחר כל השינויים במערכת
- מי עשה, מתי, מה השתנה

### Mobile Instructor UI
- ממשק מותאם למובייל למדריכים
- דיווח נוכחות מהשטח
- צפייה במפגשים

---

*עודכן לאחרונה: 2025-02-13*
