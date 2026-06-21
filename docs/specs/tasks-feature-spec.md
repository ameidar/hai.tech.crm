# אפיון — מודול משימות (Tasks) ב-HaiTech CRM

> **גרסת אפיון:** 0.1 (טיוטה) · **תאריך:** 2026-06-18 · **בעלים:** עמי מידר
> **סטטוס:** ממתין לאישור לפני פיתוח

---

## 1. רקע ומטרה

כיום משתמשים במערכת חיצונית (`haitech-tasks.base44.app`) לניהול משימות תפעול — אריאל מקבלת משם משימות ומבצעת אותן ב-CRM. בסיידבר כבר קיים לינק חיצוני "משימות תפעול".

**המטרה:** להחליף את האפליקציה החיצונית במודול משימות **מובנה** ב-CRM, כך שכל המשימות, האנשים והנתונים יישבו במקום אחד.

**עקרונות מהאפליקציה הקיימת (מהצילומים):**
- כל אחד יכול לפתוח משימה ולעשות לה **assign** למשתמש ספציפי.
- לכל משימה יש **עדיפות** (priority).
- **תזכורות** על ביצוע — דרך **WhatsApp (Green API)** ו-**מייל**.

---

## 2. משתמשים ותפקידים

משתמש בתפקידים הקיימים (`UserRole`: `admin`, `manager`, `instructor`, `sales`, `operations`).

| פעולה | מי מורשה |
|--------|----------|
| יצירת משימה | כל משתמש מחובר |
| Assign משימה למשתמש | כל משתמש מחובר |
| צפייה בכל המשימות | `admin`, `manager`, `operations` |
| צפייה במשימות שלי (שהוקצו לי / שיצרתי) | כל משתמש |
| עריכת/סגירת משימה | יוצר המשימה, המוקצה אליה, או `admin`/`manager` |
| מחיקת משימה | `admin`/`manager` בלבד (soft delete) |

> **שאלה פתוחה (1):** האם `instructor`/`sales` רואים רק את המשימות שלהם, או גם משימות כלליות? ברירת מחדל מוצעת: רק שלהם.

---

## 3. מודל נתונים (Prisma)

עוקב אחר הקונבנציות הקיימות: `id @default(uuid())`, enums ב-`snake_case`, `@@map` לטבלאות, soft-delete עם `deletedAt`.

### 3.1 `Task`
| שדה | טיפוס | הערות |
|------|--------|--------|
| `id` | `String @id @default(uuid())` | |
| `title` | `String` | חובה |
| `description` | `String?` | טקסט חופשי |
| `status` | `TaskStatus` | ברירת מחדל `open` |
| `priority` | `TaskPriority` | ברירת מחדל `normal` |
| `dueDate` | `DateTime?` | תאריך יעד לביצוע |
| `createdById` | `String` | FK → User (היוצר) |
| `assigneeId` | `String?` | FK → User (המוקצה) |
| `relatedType` | `TaskRelatedType?` | קישור אופציונלי לישות CRM |
| `relatedId` | `String?` | id של הישות המקושרת |
| `completedAt` | `DateTime?` | מתי בוצעה |
| `completedById` | `String?` | מי סימן כבוצעה |
| `createdAt` / `updatedAt` / `deletedAt` | `DateTime` | סטנדרט |

### 3.2 Enums
```prisma
enum TaskStatus {
  open           // פתוחה
  in_progress    // בביצוע
  completed      // בוצעה
  cancelled      // בוטלה
}

enum TaskPriority {
  low            // נמוכה
  normal         // רגילה
  high           // גבוהה
  urgent         // דחופה
}

enum TaskRelatedType {
  customer
  cycle
  meeting
  lead
  student
}
```

### 3.3 `TaskComment` (אופציונלי — שלב 2)
תגובות/עדכוני סטטוס פנימיים על משימה: `id`, `taskId`, `authorId`, `body`, `createdAt`.

### 3.4 `TaskReminder`
תזכורת מתוזמנת אחת או יותר למשימה:
| שדה | טיפוס | הערות |
|------|--------|--------|
| `id` | `String @id @default(uuid())` | |
| `taskId` | `String` | FK → Task |
| `channel` | `ReminderChannel` | `whatsapp` / `email` |
| `remindAt` | `DateTime` | מתי לשלוח |
| `sentAt` | `DateTime?` | סומן אחרי שליחה מוצלחת |
| `status` | `ReminderStatus` | `pending` / `sent` / `failed` |

```prisma
enum ReminderChannel { whatsapp email }
enum ReminderStatus  { pending sent failed }
```

> **קישור ל-User:** להוסיף ל-`User` יחסים הפוכים: `createdTasks Task[] @relation("TaskCreatedBy")`, `assignedTasks Task[] @relation("TaskAssignee")`.

---

## 4. תזכורות והתראות (Notifications)

מבוסס על השירותים הקיימים: `sendWhatsApp()` ב-`src/services/messaging.ts` (Green API) ו-`sendEmail()` / תור BullMQ ב-`src/services/email/`.

### 4.1 טריגרים אוטומטיים
| אירוע | ערוצים | נמען | תוכן |
|--------|---------|-------|-------|
| משימה הוקצתה למשתמש | WhatsApp + מייל | המוקצה | "הוקצתה לך משימה: {title}, יעד {dueDate}" + לינק |
| תזכורת לפני יעד | WhatsApp + מייל | המוקצה | תזכורת ביצוע |
| משימה סומנה כבוצעה | מייל (ואופ' WA) | היוצר | "המשימה {title} בוצעה ע"י {user}" |

> **שאלה פתוחה (2):** מתי בדיוק לשלוח תזכורת לפני יעד? הצעה: 24 שעות לפני + בבוקר יום היעד (09:00 שעון ישראל).
> **שאלה פתוחה (3):** מהו מספר ה-WhatsApp/Green ששולח? להשתמש באותו instance של CRM. לוודא שלכל משתמש יש `phone` תקין; אם אין — לדלג על WA ולשלוח מייל בלבד.

### 4.2 מתזמן (Scheduler)
להוסיף `initTaskReminderScheduler()` ל-`src/index.ts` (תחת `DISABLE_CRON`), עם `node-cron`, אזור זמן `Asia/Jerusalem`:
- ריצה כל 5–10 דקות → שולף `TaskReminder` עם `status=pending` ו-`remindAt <= now`, שולח, מעדכן `sentAt`/`status`.
- כיבוד שעות שקטות לפי הצורך (להחליט מול עמי).

---

## 5. API (REST, `/api/v1/tasks`)

עוקב אחר תבנית 4 השכבות הקיימת (routes → controller → service → repository) + ולידציית Zod.

| Method | Path | תיאור | הרשאה |
|--------|------|--------|--------|
| `GET` | `/tasks` | רשימה עם pagination/סינון/מיון | מחובר |
| `GET` | `/tasks/:id` | משימה בודדת | מחובר + הרשאת צפייה |
| `POST` | `/tasks` | יצירה | מחובר |
| `PATCH` | `/tasks/:id` | עדכון שדות / assign / priority | יוצר/מוקצה/manager |
| `POST` | `/tasks/:id/complete` | סימון כבוצעה | מוקצה/manager |
| `POST` | `/tasks/:id/reopen` | פתיחה מחדש | manager |
| `DELETE` | `/tasks/:id` | soft delete | admin/manager |
| `GET` | `/tasks/:id/comments` / `POST` | תגובות (שלב 2) | מחובר |

**פרמטרי סינון ל-`GET /tasks`:** `status`, `priority`, `assigneeId`, `createdById`, `relatedType`+`relatedId`, `dueFrom`/`dueTo`, `search`, `page`, `limit`, `sortBy`, `sortDir`.
ברירת מחדל למשתמש לא-מנהל: מסונן ל-`assigneeId = me OR createdById = me`.

---

## 6. Frontend

מיקום: `frontend/src/pages/Tasks.tsx` + hooks ב-`useApi.ts` (React Query) בתבנית `useTasks` / `useCreateTask` / `useUpdateTask`.

### 6.1 ניווט
לשנות את פריט הסיידבר "משימות תפעול" (כיום לינק חיצוני ל-base44 ב-`Layout.tsx`) ל-route פנימי `/tasks`.

### 6.2 מסך ראשי — לוח Kanban (כמו ב-base44)
**זהו ה-frontend הראשי.** לוח עם עמודות לפי סטטוס:
`פתוחה (open)` · `בביצוע (in_progress)` · `בוצעה (completed)` (ו-`בוטלה` כעמודה/פילטר נפרד).
- **גרירת כרטיס בין עמודות** (drag & drop) מעדכנת את `status` של המשימה דרך `PATCH /tasks/:id` (או `/complete` בגרירה לעמודת "בוצעה"). מומלץ `@dnd-kit` או `react-beautiful-dnd`.
- כל כרטיס מציג: כותרת, תגית עדיפות צבעונית, אוואטר/שם המוקצה, תאריך יעד (אדום אם overdue).
- סינון מעל הלוח: עדיפות, מוקצה, תאריך יעד, חיפוש טקסט.
- כפתור "+ משימה חדשה".
- Toggle אופציונלי ל-**תצוגת רשימה** (grid/list) לצד ה-Kanban, לפי קונבנציית ה-UI של ה-CRM (localStorage key: `tasks-view`).
- תגיות צבע לעדיפות: urgent=אדום, high=כתום, normal=אפור, low=כחול בהיר.

### 6.3 יצירה/עריכה (Modal)
שדות: כותרת, תיאור, עדיפות, תאריך יעד, **assign למשתמש** (dropdown ממשתמשים פעילים), קישור אופציונלי לישות CRM (לקוח/מחזור/...).

### 6.4 פירוט משימה
תצוגת פרטים מלאה + פעולות (assign מחדש, שינוי סטטוס, סמן כבוצעה), ושלב 2: ציר תגובות/היסטוריה.

---

## 7. שלבי פיתוח מוצעים

**Phase 1 — ליבה (MVP):**
1. מיגרציית Prisma: `Task`, enums, יחסים ל-`User`.
2. Backend CRUD מלא + הרשאות + Zod.
3. Frontend: **לוח Kanban עם drag & drop בין שלבים** + מודאל יצירה/עריכה + assign + עדיפות + החלפת הלינק בסיידבר ל-route פנימי.
4. התראת assign אחת (WhatsApp + מייל).

**Phase 2 — תזכורות והעשרה:**
5. `TaskReminder` + scheduler (תזכורות לפני יעד, התראת "בוצעה" ליוצר).
6. תגובות/היסטוריה, קישור לישויות CRM, תצוגת רשימה לצד ה-Kanban.

**Phase 3 — מיגרציה:**
7. ייבוא המשימות הקיימות מ-base44 (אם נדרש) והשבתת הלינק החיצוני.

---

## 8. שאלות פתוחות לעמי (לפני פיתוח)
1. **שלבי ה-Kanban** — האם 3 העמודות (פתוחה / בביצוע / בוצעה) מספיקות, או שב-base44 היו שלבים נוספים (למשל "ממתין"/"בבדיקה")? אם יש — אילו?
2. **הרשאות צפייה** ל-instructor/sales — רק משימות שלהם, או הלוח המלא לכולם?
3. **תזמון התזכורת לפני יעד** — הצעה: 24ש' לפני + 09:00 ביום היעד. מאשר?
4. **WhatsApp** — להשתמש ב-instance של ה-CRM? ומה לעשות עם משתמש בלי טלפון (לדלג ל-מייל בלבד?).
5. **ייבוא היסטוריה** — לייבא משימות קיימות מ-base44, או להתחיל נקי?
