# HaiTech CRM API - מדריך מהיר

**גרסה:** 1.0.0  
**כתובת בסיס:** `https://your-domain.com/api/v1`

---

## 🔐 אימות

### שתי דרכי אימות:

**1. JWT (למשתמשים אינטראקטיביים)**
```bash
# התחברות
curl -X POST /api/v1/auth/login \
  -d '{"email": "user@example.com", "password": "xxx"}'

# שימוש בטוקן
curl /api/v1/cycles -H "Authorization: Bearer eyJhbG..."
```

**2. API Key (לאינטגרציות חיצוניות)**
```bash
curl /api/v1/cycles -H "X-API-Key: haitech_xxxxx"
```

---

## 📋 רשימת נקודות קצה

### לקוחות (Customers) - הורים/משלמים
| פעולה | נתיב | הרשאה |
|-------|------|--------|
| רשימה | `GET /customers` | authenticated |
| פרטים | `GET /customers/:id` | authenticated |
| יצירה | `POST /customers` | manager/admin |
| עדכון | `PUT /customers/:id` | manager/admin |
| מחיקה | `DELETE /customers/:id` | manager/admin |
| ילדים | `GET /customers/:id/students` | authenticated |
| הוספת ילד | `POST /customers/:id/students` | manager/admin |

### תלמידים (Students)
| פעולה | נתיב | הרשאה |
|-------|------|--------|
| רשימה | `GET /students` | authenticated |
| פרטים | `GET /students/:id` | authenticated |
| יצירה | `POST /students` | manager/admin |
| עדכון | `PUT /students/:id` | manager/admin |
| מחיקה | `DELETE /students/:id` | manager/admin |
| הרשמות | `GET /students/:id/registrations` | authenticated |

### מדריכים (Instructors)
| פעולה | נתיב | הרשאה |
|-------|------|--------|
| רשימה | `GET /instructors` | authenticated |
| פרטים | `GET /instructors/:id` | authenticated |
| יצירה | `POST /instructors` | **admin only** |
| עדכון | `PUT /instructors/:id` | manager/admin |
| מחיקה | `DELETE /instructors/:id` | **admin only** |
| מחזורים | `GET /instructors/:id/cycles` | authenticated |
| פגישות | `GET /instructors/:id/meetings` | authenticated |

### סניפים (Branches)
| פעולה | נתיב | הרשאה |
|-------|------|--------|
| רשימה | `GET /branches` | authenticated |
| פרטים | `GET /branches/:id` | authenticated |
| יצירה | `POST /branches` | **admin only** |
| עדכון | `PUT /branches/:id` | manager/admin |
| מחיקה | `DELETE /branches/:id` | **admin only** |
| מחזורים | `GET /branches/:id/cycles` | authenticated |

### קורסים (Courses)
| פעולה | נתיב | הרשאה |
|-------|------|--------|
| רשימה | `GET /courses` | authenticated |
| פרטים | `GET /courses/:id` | authenticated |
| יצירה | `POST /courses` | **admin only** |
| עדכון | `PUT /courses/:id` | **admin only** |
| מחיקה | `DELETE /courses/:id` | **admin only** |
| מחזורים | `GET /courses/:id/cycles` | authenticated |

### מחזורים (Cycles)
| פעולה | נתיב | הרשאה |
|-------|------|--------|
| רשימה | `GET /cycles` | authenticated |
| פרטים | `GET /cycles/:id` | authenticated |
| יצירה | `POST /cycles` | manager/admin |
| עדכון | `PUT /cycles/:id` | manager/admin |
| מחיקה | `DELETE /cycles/:id` | manager/admin |
| פגישות | `GET /cycles/:id/meetings` | authenticated |
| הרשמות | `GET /cycles/:id/registrations` | authenticated |
| הוספת הרשמה | `POST /cycles/:id/registrations` | manager/admin |
| יצירת פגישות | `POST /cycles/:id/generate-meetings` | manager/admin |
| שכפול | `POST /cycles/:id/duplicate` | manager/admin |
| עדכון מרובה | `POST /cycles/bulk-update` | manager/admin |

### פגישות (Meetings)
| פעולה | נתיב | הרשאה |
|-------|------|--------|
| רשימה | `GET /meetings` | authenticated |
| פרטים | `GET /meetings/:id` | authenticated |
| יצירה | `POST /meetings` | manager/admin |
| עדכון | `PUT /meetings/:id` | authenticated* |
| מחיקה | `DELETE /meetings/:id` | manager/admin |
| נוכחות | `GET /meetings/:id/attendance` | authenticated |
| נוכחות מרובה | `POST /meetings/:id/attendance/bulk` | authenticated |
| סיום | `POST /meetings/:id/complete` | authenticated |
| ביטול | `POST /meetings/:id/cancel` | manager/admin |
| דחייה | `POST /meetings/:id/postpone` | manager/admin |
| חישוב מחדש | `POST /meetings/:id/recalculate` | manager/admin |
| מחיקה מרובה | `POST /meetings/bulk-delete` | manager/admin |

*מדריך יכול לעדכן רק ביום הפגישה

### הרשמות (Registrations)
| פעולה | נתיב | הרשאה |
|-------|------|--------|
| רשימה | `GET /registrations` | authenticated |
| פרטים | `GET /registrations/:id` | authenticated |
| יצירה | `POST /registrations` | manager/admin |
| עדכון | `PUT /registrations/:id` | manager/admin |
| מחיקה | `DELETE /registrations/:id` | manager/admin |
| נוכחות | `GET /registrations/:id/attendance` | authenticated |
| ביטול | `POST /registrations/:id/cancel` | manager/admin |
| עדכון תשלום | `POST /registrations/:id/payment` | manager/admin |

### נוכחות (Attendance)
| פעולה | נתיב | הרשאה |
|-------|------|--------|
| רשימה | `GET /attendance` | authenticated |
| פרטים | `GET /attendance/:id` | authenticated |
| יצירה | `POST /attendance` | authenticated |
| עדכון | `PUT /attendance/:id` | authenticated |
| מחיקה | `DELETE /attendance/:id` | manager/admin |
| מרובה | `POST /attendance/bulk` | authenticated |

### דוחות (Reports)
| דוח | נתיב | הרשאה |
|-----|------|--------|
| הכנסות | `GET /reports/revenue` | manager/admin |
| ייצוא הכנסות | `GET /reports/revenue/export` | manager/admin |
| תשלומי מדריכים | `GET /reports/instructor-payments` | manager/admin |
| ייצוא תשלומים | `GET /reports/instructor-payments/export` | manager/admin |
| נוכחות | `GET /reports/attendance` | manager/admin |
| התקדמות מחזורים | `GET /reports/cycle-progress` | manager/admin |
| ייצוא התקדמות | `GET /reports/cycle-progress/export` | manager/admin |

---

## 🔑 Enums (ערכים קבועים)

### סוג מחזור (type)
- `private` - שיעור פרטי
- `institutional_per_child` - מוסדי - לפי ילד
- `institutional_fixed` - מוסדי - מחיר קבוע

### סטטוס מחזור (status)
- `active` - פעיל
- `completed` - הושלם
- `cancelled` - בוטל

### יום בשבוע (dayOfWeek)
- `sunday`, `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`

### סוג פעילות (activityType)
- `online` - מקוון
- `frontal` - פרונטלי
- `private_lesson` - שיעור פרטי

### סטטוס פגישה (status)
- `scheduled` - מתוכנן
- `completed` - הושלם
- `cancelled` - בוטל
- `postponed` - נדחה

### סטטוס הרשמה (status)
- `registered` - רשום
- `active` - פעיל
- `completed` - הושלם
- `cancelled` - בוטל
- `trial` - ניסיון

### סטטוס תשלום (paymentStatus)
- `unpaid` - לא שולם
- `partial` - שולם חלקית
- `paid` - שולם

### אמצעי תשלום (paymentMethod)
- `credit` - אשראי
- `transfer` - העברה
- `cash` - מזומן

### סטטוס נוכחות (status)
- `present` - נוכח
- `absent` - נעדר
- `late` - איחר

### סוג סניף (type)
- `school` - בית ספר
- `community_center` - מתנ"ס
- `frontal` - פרונטלי
- `online` - מקוון

### קטגוריית קורס (category)
- `programming` - תכנות
- `ai` - בינה מלאכותית
- `robotics` - רובוטיקה
- `printing_3d` - הדפסת תלת-מימד

---

## 🔒 Scopes (הרשאות API Key)

```
*                    - גישה מלאה
read:*               - קריאה של הכל
write:*              - כתיבה של הכל
read:customers       - קריאת לקוחות
write:customers      - כתיבת לקוחות
read:students        - קריאת תלמידים
write:students       - כתיבת תלמידים
read:courses         - קריאת קורסים
write:courses        - כתיבת קורסים
read:branches        - קריאת סניפים
write:branches       - כתיבת סניפים
read:instructors     - קריאת מדריכים
write:instructors    - כתיבת מדריכים
read:cycles          - קריאת מחזורים
write:cycles         - כתיבת מחזורים
read:meetings        - קריאת פגישות
write:meetings       - כתיבת פגישות
read:registrations   - קריאת הרשמות
write:registrations  - כתיבת הרשמות
read:attendance      - קריאת נוכחות
write:attendance     - כתיבת נוכחות
read:reports         - קריאת דוחות
```

---

## 📄 דוגמאות

### שליפת כל המחזורים הפעילים
```bash
curl "https://api.example.com/api/v1/cycles?status=active" \
  -H "X-API-Key: haitech_xxxxx"
```

### יצירת הרשמה חדשה
```bash
curl -X POST "https://api.example.com/api/v1/registrations" \
  -H "X-API-Key: haitech_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "studentId": "uuid",
    "cycleId": "uuid",
    "amount": 3000,
    "paymentStatus": "unpaid"
  }'
```

### עדכון סטטוס תשלום
```bash
curl -X POST "https://api.example.com/api/v1/registrations/uuid/payment" \
  -H "X-API-Key: haitech_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentStatus": "paid",
    "paymentMethod": "credit"
  }'
```

### דיווח נוכחות מרובה
```bash
curl -X POST "https://api.example.com/api/v1/meetings/uuid/attendance/bulk" \
  -H "X-API-Key: haitech_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "meetingId": "uuid",
    "records": [
      {"registrationId": "uuid1", "status": "present"},
      {"registrationId": "uuid2", "status": "absent"}
    ]
  }'
```

---

## ⚠️ שגיאות נפוצות

| קוד HTTP | משמעות | פתרון |
|----------|---------|-------|
| 400 | בקשה לא תקינה | בדוק את הפרמטרים |
| 401 | לא מאומת | הוסף API Key או Token |
| 403 | אין הרשאה | הרשאות לא מספיקות |
| 404 | לא נמצא | בדוק את ה-ID |
| 429 | יותר מדי בקשות | המתן וחזור שוב |

---

## 📞 תמיכה

לתמיכה טכנית: support@hai.tech
