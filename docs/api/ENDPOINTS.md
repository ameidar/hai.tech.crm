# HaiTech CRM - API Endpoints Reference

## Base URL
```
Production: https://api.haitech-crm.com/api/v1
Development: http://localhost:3000/api/v1
```

---

## Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/auth/login` | התחברות | ❌ |
| POST | `/auth/register` | רישום משתמש חדש | Admin |
| POST | `/auth/refresh` | חידוש token | ❌ |
| POST | `/auth/logout` | התנתקות | ✅ |
| GET | `/auth/me` | פרטי משתמש נוכחי | ✅ |
| PUT | `/auth/password` | שינוי סיסמה | ✅ |
| POST | `/auth/forgot-password` | שכחתי סיסמה | ❌ |
| POST | `/auth/reset-password` | איפוס סיסמה | ❌ |

---

## Users (משתמשים)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/users` | רשימת משתמשים | ✅ | admin |
| GET | `/users/:id` | משתמש בודד | ✅ | admin |
| POST | `/users` | יצירת משתמש | ✅ | admin |
| PUT | `/users/:id` | עדכון משתמש | ✅ | admin |
| DELETE | `/users/:id` | מחיקת משתמש | ✅ | admin |
| POST | `/users/:id/activate` | הפעלת משתמש | ✅ | admin |
| POST | `/users/:id/deactivate` | השבתת משתמש | ✅ | admin |

---

## Customers (לקוחות)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/customers` | רשימת לקוחות | ✅ | all |
| GET | `/customers/:id` | לקוח בודד | ✅ | all |
| POST | `/customers` | יצירת לקוח | ✅ | admin, manager |
| PUT | `/customers/:id` | עדכון לקוח | ✅ | admin, manager |
| DELETE | `/customers/:id` | מחיקת לקוח (soft) | ✅ | admin, manager |
| GET | `/customers/:id/students` | תלמידים של לקוח | ✅ | all |
| POST | `/customers/:id/students` | הוספת תלמיד ללקוח | ✅ | admin, manager |
| GET | `/customers/:id/registrations` | הרשמות של לקוח | ✅ | all |
| GET | `/customers/search` | חיפוש לקוחות | ✅ | all |

### Query Parameters (GET /customers)
```
?search=string          // חיפוש בשם/טלפון/אימייל
&city=string           // סינון לפי עיר
&hasActiveRegistration=boolean
&limit=20&offset=0     // pagination
&sortBy=name&sortOrder=asc
```

---

## Students (תלמידים)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/students` | רשימת תלמידים | ✅ | all |
| GET | `/students/:id` | תלמיד בודד | ✅ | all |
| POST | `/students` | יצירת תלמיד | ✅ | admin, manager |
| PUT | `/students/:id` | עדכון תלמיד | ✅ | admin, manager |
| DELETE | `/students/:id` | מחיקת תלמיד (soft) | ✅ | admin, manager |
| GET | `/students/:id/registrations` | הרשמות של תלמיד | ✅ | all |
| GET | `/students/:id/attendance` | נוכחות של תלמיד | ✅ | all |

### Query Parameters (GET /students)
```
?customerId=uuid       // סינון לפי לקוח
&grade=string         // סינון לפי כיתה
&search=string        // חיפוש בשם
&limit=20&offset=0
```

---

## Courses (קורסים)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/courses` | רשימת קורסים | ✅ | all |
| GET | `/courses/:id` | קורס בודד | ✅ | all |
| POST | `/courses` | יצירת קורס | ✅ | admin |
| PUT | `/courses/:id` | עדכון קורס | ✅ | admin |
| DELETE | `/courses/:id` | מחיקת קורס | ✅ | admin |
| GET | `/courses/:id/cycles` | מחזורים של קורס | ✅ | all |

### Query Parameters (GET /courses)
```
?category=programming|ai|robotics|3d_printing
&isActive=boolean
&search=string
```

---

## Branches (סניפים)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/branches` | רשימת סניפים | ✅ | all |
| GET | `/branches/:id` | סניף בודד | ✅ | all |
| POST | `/branches` | יצירת סניף | ✅ | admin |
| PUT | `/branches/:id` | עדכון סניף | ✅ | admin, manager |
| DELETE | `/branches/:id` | מחיקת סניף | ✅ | admin |
| GET | `/branches/:id/cycles` | מחזורים בסניף | ✅ | all |
| GET | `/branches/:id/orders` | הזמנות מוסדיות | ✅ | admin, manager |

### Query Parameters (GET /branches)
```
?type=school|community_center|frontal|online
&city=string
&isActive=boolean
&search=string
```

---

## Instructors (מדריכים)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/instructors` | רשימת מדריכים | ✅ | all |
| GET | `/instructors/:id` | מדריך בודד | ✅ | all |
| POST | `/instructors` | יצירת מדריך | ✅ | admin |
| PUT | `/instructors/:id` | עדכון מדריך | ✅ | admin, manager |
| DELETE | `/instructors/:id` | מחיקת מדריך | ✅ | admin |
| GET | `/instructors/:id/cycles` | מחזורים של מדריך | ✅ | all |
| GET | `/instructors/:id/meetings` | פגישות של מדריך | ✅ | all, instructor(self) |
| GET | `/instructors/:id/schedule` | לוח זמנים | ✅ | all, instructor(self) |
| POST | `/instructors/:id/invite` | שליחת הזמנה למערכת | ✅ | admin |

### Query Parameters (GET /instructors)
```
?isActive=boolean
&search=string
&hasAvailability=boolean
```

---

## Institutional Orders (הזמנות מוסדיות)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/institutional-orders` | רשימת הזמנות | ✅ | admin, manager |
| GET | `/institutional-orders/:id` | הזמנה בודדת | ✅ | admin, manager |
| POST | `/institutional-orders` | יצירת הזמנה | ✅ | admin, manager |
| PUT | `/institutional-orders/:id` | עדכון הזמנה | ✅ | admin, manager |
| DELETE | `/institutional-orders/:id` | מחיקת הזמנה | ✅ | admin |
| GET | `/institutional-orders/:id/cycles` | מחזורים בהזמנה | ✅ | admin, manager |

### Query Parameters (GET /institutional-orders)
```
?branchId=uuid
&status=draft|active|completed|cancelled
&from=date&to=date
```

---

## Cycles (מחזורים)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/cycles` | רשימת מחזורים | ✅ | all |
| GET | `/cycles/:id` | מחזור בודד | ✅ | all |
| POST | `/cycles` | יצירת מחזור | ✅ | admin, manager |
| PUT | `/cycles/:id` | עדכון מחזור | ✅ | admin, manager |
| DELETE | `/cycles/:id` | מחיקת מחזור (soft) | ✅ | admin |
| GET | `/cycles/:id/meetings` | פגישות של מחזור | ✅ | all |
| GET | `/cycles/:id/registrations` | הרשמות למחזור | ✅ | all |
| POST | `/cycles/:id/registrations` | הרשמה למחזור | ✅ | admin, manager |
| POST | `/cycles/:id/generate-meetings` | יצירת פגישות | ✅ | admin, manager |
| POST | `/cycles/:id/sync-progress` | סנכרון התקדמות | ✅ | admin, manager |
| POST | `/cycles/:id/duplicate` | שכפול מחזור | ✅ | admin, manager |
| POST | `/cycles/bulk-update` | עדכון גורף | ✅ | admin |
| POST | `/cycles/bulk-generate-meetings` | יצירת פגישות גורפת | ✅ | admin |

### Query Parameters (GET /cycles)
```
?courseId=uuid
&branchId=uuid
&instructorId=uuid
&type=private|institutional_per_child|institutional_fixed
&status=active|completed|cancelled
&dayOfWeek=sunday|monday|...
&from=date&to=date
&search=string
&limit=20&offset=0
&sortBy=startDate&sortOrder=desc
```

---

## Meetings (פגישות)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/meetings` | רשימת פגישות | ✅ | all |
| GET | `/meetings/:id` | פגישה בודדת | ✅ | all |
| POST | `/meetings` | יצירת פגישה (חריגה) | ✅ | admin, manager |
| PUT | `/meetings/:id` | עדכון פגישה | ✅ | admin, manager, instructor(self) |
| DELETE | `/meetings/:id` | מחיקת פגישה | ✅ | admin |
| POST | `/meetings/:id/complete` | סימון כהושלמה | ✅ | admin, manager, instructor(self) |
| POST | `/meetings/:id/cancel` | ביטול פגישה | ✅ | admin, manager |
| POST | `/meetings/:id/postpone` | דחיית פגישה | ✅ | admin, manager |
| POST | `/meetings/:id/recalculate` | חישוב כספים מחדש | ✅ | admin, manager |
| GET | `/meetings/:id/attendance` | נוכחות בפגישה | ✅ | all |
| POST | `/meetings/:id/attendance` | רישום נוכחות | ✅ | admin, manager, instructor(self) |
| PUT | `/meetings/:id/attendance/bulk` | עדכון נוכחות גורף | ✅ | admin, manager, instructor(self) |
| POST | `/meetings/bulk-recalculate` | חישוב גורף | ✅ | admin |
| POST | `/meetings/bulk-update-status` | עדכון סטטוס גורף | ✅ | admin |
| POST | `/meetings/bulk-delete` | מחיקה גורפת | ✅ | admin |

### Query Parameters (GET /meetings)
```
?cycleId=uuid
&instructorId=uuid
&status=scheduled|completed|cancelled|postponed
&from=date&to=date
&date=date                    // פגישות ביום ספציפי
&activityType=online|frontal|private
&limit=20&offset=0
&sortBy=scheduledDate&sortOrder=asc
```

---

## Registrations (הרשמות)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/registrations` | רשימת הרשמות | ✅ | all |
| GET | `/registrations/:id` | הרשמה בודדת | ✅ | all |
| POST | `/registrations` | יצירת הרשמה | ✅ | admin, manager |
| PUT | `/registrations/:id` | עדכון הרשמה | ✅ | admin, manager |
| DELETE | `/registrations/:id` | מחיקת הרשמה | ✅ | admin |
| POST | `/registrations/:id/cancel` | ביטול הרשמה | ✅ | admin, manager |
| POST | `/registrations/:id/payment` | עדכון תשלום | ✅ | admin, manager |
| GET | `/registrations/:id/attendance` | נוכחות של הרשמה | ✅ | all |

### Query Parameters (GET /registrations)
```
?studentId=uuid
&cycleId=uuid
&status=registered|active|completed|cancelled|trial
&paymentStatus=unpaid|partial|paid
&from=date&to=date
```

---

## Attendance (נוכחות)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/attendance` | רשימת נוכחות | ✅ | all |
| GET | `/attendance/:id` | רשומת נוכחות | ✅ | all |
| POST | `/attendance` | רישום נוכחות | ✅ | admin, manager, instructor |
| PUT | `/attendance/:id` | עדכון נוכחות | ✅ | admin, manager, instructor |
| DELETE | `/attendance/:id` | מחיקת נוכחות | ✅ | admin |
| GET | `/attendance/meeting/:meetingId` | נוכחות בפגישה | ✅ | all |
| POST | `/attendance/meeting/:meetingId/bulk` | רישום נוכחות גורף | ✅ | admin, manager, instructor |

### Query Parameters (GET /attendance)
```
?meetingId=uuid
&studentId=uuid
&registrationId=uuid
&status=present|absent|late
&isTrial=boolean
&from=date&to=date
```

---

## Audit Logs (לוגים)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/audit-logs` | רשימת לוגים | ✅ | admin |
| GET | `/audit-logs/:id` | לוג בודד | ✅ | admin |
| GET | `/audit-logs/entity/:entity/:entityId` | לוגים של ישות | ✅ | admin |

### Query Parameters (GET /audit-logs)
```
?userId=uuid
&action=CREATE|UPDATE|DELETE
&entity=Customer|Cycle|Meeting|...
&entityId=uuid
&from=datetime&to=datetime
&limit=50&offset=0
```

---

## Saved Views (תצוגות שמורות)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/saved-views` | התצוגות שלי | ✅ | all |
| GET | `/saved-views/:id` | תצוגה בודדת | ✅ | all |
| POST | `/saved-views` | יצירת תצוגה | ✅ | all |
| PUT | `/saved-views/:id` | עדכון תצוגה | ✅ | owner/admin |
| DELETE | `/saved-views/:id` | מחיקת תצוגה | ✅ | owner/admin |
| POST | `/saved-views/:id/set-default` | הגדרה כברירת מחדל | ✅ | owner |

---

## Webhooks (ניהול)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/webhooks` | רשימת webhooks | ✅ | admin |
| GET | `/webhooks/:id` | webhook בודד | ✅ | admin |
| POST | `/webhooks` | יצירת webhook | ✅ | admin |
| PUT | `/webhooks/:id` | עדכון webhook | ✅ | admin |
| DELETE | `/webhooks/:id` | מחיקת webhook | ✅ | admin |
| POST | `/webhooks/:id/test` | בדיקת webhook | ✅ | admin |
| GET | `/webhooks/:id/deliveries` | היסטוריית שליחות | ✅ | admin |
| POST | `/webhooks/:id/deliveries/:deliveryId/retry` | שליחה מחדש | ✅ | admin |

---

## API Keys (מפתחות)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/api-keys` | רשימת מפתחות | ✅ | admin |
| POST | `/api-keys` | יצירת מפתח | ✅ | admin |
| DELETE | `/api-keys/:id` | ביטול מפתח | ✅ | admin |
| POST | `/api-keys/:id/rotate` | סיבוב מפתח | ✅ | admin |

---

## Reports (דוחות)

| Method | Endpoint | Description | Auth | Roles |
|--------|----------|-------------|------|-------|
| GET | `/reports/revenue` | דוח הכנסות | ✅ | admin, manager |
| GET | `/reports/instructor-payments` | דוח תשלומים למדריכים | ✅ | admin, manager |
| GET | `/reports/attendance-summary` | סיכום נוכחות | ✅ | admin, manager |
| GET | `/reports/cycle-progress` | התקדמות מחזורים | ✅ | admin, manager |
| POST | `/reports/export` | ייצוא דוח | ✅ | admin, manager |

### Query Parameters (דוחות)
```
?from=date&to=date
&branchId=uuid
&instructorId=uuid
&format=json|csv|xlsx
```

---

## Health & Meta

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/health` | בדיקת תקינות | ❌ |
| GET | `/health/ready` | מוכנות לעומס | ❌ |
| GET | `/meta/version` | גרסת API | ❌ |
| GET | `/meta/schema` | OpenAPI schema | ❌ |

---

## Integration Endpoints (Public)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/public/leads` | קבלת ליד מאתר | API Key |
| GET | `/public/meetings/:token` | פרטי פגישה (למדריך) | Token |
| POST | `/public/meetings/:token/complete` | סיום פגישה (למדריך) | Token |
| POST | `/public/zoom-webhook` | Zoom events | Signature |

---

## סיכום כמותי

| קטגוריה | Endpoints |
|----------|-----------|
| Authentication | 8 |
| Users | 7 |
| Customers | 9 |
| Students | 7 |
| Courses | 6 |
| Branches | 7 |
| Instructors | 9 |
| Institutional Orders | 6 |
| Cycles | 13 |
| Meetings | 17 |
| Registrations | 9 |
| Attendance | 8 |
| Audit Logs | 3 |
| Saved Views | 6 |
| Webhooks | 8 |
| API Keys | 4 |
| Reports | 5 |
| Health/Meta | 4 |
| Public/Integration | 4 |
| **Total** | **~140** |
