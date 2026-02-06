# HaiTech CRM - API Documentation

## מסמכים

| קובץ | תיאור |
|------|-------|
| [API_ARCHITECTURE.md](./API_ARCHITECTURE.md) | ארכיטקטורת API - עקרונות, אבטחה, סטנדרטים |
| [ENDPOINTS.md](./ENDPOINTS.md) | טבלת endpoints מלאה (~140 endpoints) |
| [WORK_PLAN.md](./WORK_PLAN.md) | תכנית עבודה מפורטת ב-6 שלבים |
| [openapi/openapi.yaml](./openapi/openapi.yaml) | OpenAPI 3.0 specification |

## סיכום מהיר

### אובייקטים (Entities)
- **Users** - משתמשי המערכת
- **Customers** - לקוחות (הורים)
- **Students** - תלמידים
- **Courses** - קורסים
- **Branches** - סניפים/מוסדות
- **Instructors** - מדריכים
- **InstitutionalOrders** - הזמנות מוסדיות
- **Cycles** - מחזורים
- **Meetings** - פגישות/שיעורים
- **Registrations** - הרשמות
- **Attendance** - נוכחות

### Authentication
```http
# JWT (UI)
Authorization: Bearer eyJhbG...

# API Key (Integrations)
X-API-Key: haitech_live_abc123...
```

### Response Format
```json
{
  "data": { ... },
  "pagination": { "total": 100, "limit": 20, "offset": 0, "hasMore": true },
  "meta": { "requestId": "uuid", "timestamp": "2026-02-06T12:00:00Z" }
}
```

### Timeline
- **MVP (Core CRUD)**: 3-5 שבועות
- **Full API**: 10-15 שבועות

## החלטות עיצוב

| נושא | החלטה |
|------|--------|
| API Keys | HTTP requests בלבד, ללא ממשק ניהול |
| Webhooks | רישום ע"י Admin בלבד |
| Multi-tenant | לא נדרש (ארגון יחיד) |
| Real-time | לא נדרש (refresh ידני) |
| GDPR Export | לא נדרש |

---

*נוצר: 2025-02-06 | עודכן: 2025-02-06*
