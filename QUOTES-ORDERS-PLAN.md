# תכנון: הצעות מחיר והזמנות מוסדיות

## סקירה
מודול חדש ב-HaiTech CRM לניהול תהליך המכירה למוסדות חינוך:
הצעת מחיר (Quote) → אישור → הזמנה (Order) → מחזורים (Cycles)

---

## ישויות

### Quote (הצעת מחיר)
```
Quote {
  id: UUID (PK)
  quoteNumber: string (auto)        // QT-2026-001
  
  // לקוח
  branchId?: FK → Branch             // אם קיים במערכת
  institutionName: string            // שם המוסד (חופשי)
  contactName: string
  contactPhone: string
  contactEmail?: string
  contactRole?: string               // תפקיד איש קשר
  
  // תוכן ההצעה
  content: JSON                      // התוכן שה-AI ייצר (markdown/structured)
  
  // פריטי הצעה (קורסים + תמחור)
  items: QuoteItem[]
  
  // סיכום כספי
  totalAmount: decimal
  discount?: decimal
  finalAmount: decimal
  
  // מטא
  validUntil?: date                  // תוקף ההצעה
  status: enum (draft, sent, accepted, rejected, expired, converted)
  notes?: text
  
  // קשרים
  orderId?: FK → InstitutionalOrder  // אם הומרה להזמנה
  createdBy: FK → User
  createdAt: timestamp
  updatedAt: timestamp
}

QuoteItem {
  id: UUID (PK)
  quoteId: FK → Quote
  
  courseId?: FK → Course             // קורס מהמערכת
  courseName: string                 // שם (חופשי, למקרה שאין courseId)
  description?: text
  
  // תמחור
  groups: integer                    // מספר קבוצות
  meetingsPerGroup: integer          // מפגשים לקבוצה
  pricePerMeeting: decimal           // מחיר למפגש
  meetingDuration: integer           // משך מפגש בדקות
  subtotal: decimal                  // groups × meetings × price
  
  sortOrder: integer
}
```

### InstitutionalOrder (הזמנה - הרחבה)
המודל הקיים + שדות חדשים:
```
+ quoteId?: FK → Quote               // מאיזו הצעה נוצרה
+ totalAmount: decimal               // סכום כולל
+ invoiceNumber?: string             // מספר חשבונית
+ invoiceLink?: string               // לינק לחשבונית ירוקה
+ paymentStatus: enum (pending, partial, paid)
+ paidAmount: decimal
```

---

## זרימת עבודה

### שלב 1: אשף הצעת מחיר
```
[שם מוסד] → [בחירת קורסים + כמויות] → [תמחור] → [AI מייצר תוכן] → [תצוגה מקדימה + עריכה] → [שמירה]
```

#### מסכי האשף:
1. **פרטי מוסד** — שם, איש קשר, טלפון, מייל
2. **בחירת קורסים** — מרשימת הקורסים במערכת + הגדרת כמויות (קבוצות, מפגשים, משך)
3. **תמחור** — מחיר למפגש, הנחות, סה"כ
4. **יצירת תוכן AI** — על בסיס המוסד + הקורסים שנבחרו, AI מייצר:
   - מבוא על דרך ההייטק
   - ניתוח צרכים מותאם למוסד
   - תיאור הקורסים המומלצים
   - טבלת תמחור
   - סיכום והמלצות
5. **תצוגה מקדימה** — עריכה חופשית של התוכן + שמירה

### שלב 2: שליחה
- שמירה כ-PDF
- שליחה במייל / WhatsApp
- מעקב סטטוס

### שלב 3: המרה להזמנה
- Quote שאושרה → כפתור "המר להזמנה"
- יוצר InstitutionalOrder עם כל הנתונים
- אפשרות ליצור מחזורים אוטומטית מפריטי ההזמנה

---

## API Endpoints

### Quotes
```
GET    /api/quotes                    // רשימה + פילטרים
GET    /api/quotes/:id                // הצעה בודדת
POST   /api/quotes                    // יצירה
PUT    /api/quotes/:id                // עדכון
DELETE /api/quotes/:id                // מחיקה (רק draft)
POST   /api/quotes/:id/generate       // AI content generation
POST   /api/quotes/:id/send           // שליחה ללקוח
POST   /api/quotes/:id/convert        // המרה להזמנה
GET    /api/quotes/:id/pdf            // הורדת PDF
```

### Orders (הרחבה)
```
GET    /api/orders                     // רשימה
GET    /api/orders/:id                 // הזמנה בודדת
PUT    /api/orders/:id                 // עדכון
POST   /api/orders/:id/create-cycles   // יצירת מחזורים מההזמנה
```

---

## דפי Frontend

1. **Quotes List** (`/quotes`) — טבלה עם פילטרים (סטטוס, תאריך, מוסד)
2. **Quote Wizard** (`/quotes/new`) — אשף 5 שלבים
3. **Quote Detail** (`/quotes/:id`) — צפייה + עריכה + פעולות
4. **Orders List** (`/orders`) — טבלה עם פילטרים
5. **Order Detail** (`/orders/:id`) — צפייה + מחזורים מקושרים

---

## AI Content Generation

### Prompt Template
```
אתה כותב הצעת מחיר מקצועית עבור חברת "דרך ההייטק".

פרטי המוסד: {institutionName}
איש קשר: {contactName}, {contactRole}

קורסים שנבחרו:
{items.map(item => `- ${item.courseName}: ${item.groups} קבוצות × ${item.meetingsPerGroup} מפגשים`)}

סה"כ: {finalAmount} ₪

כתוב הצעת מחיר הכוללת:
1. מבוא על דרך ההייטק
2. ניתוח צרכים של המוסד
3. תיאור כל קורס והתאמתו למוסד
4. טבלת תמחור
5. סיכום והמלצות

הטון: מקצועי, חם, משכנע. בעברית.
```

### מודל
- Claude / GPT-4 via API
- Cache template sections (מבוא על החברה) — לא צריך לייצר כל פעם

---

## שלבי פיתוח

### Phase 1: Backend
- [ ] Schema: Quote, QuoteItem models
- [ ] הרחבת InstitutionalOrder
- [ ] Migration
- [ ] CRUD API for quotes
- [ ] AI generation endpoint

### Phase 2: Frontend
- [ ] Quote Wizard component (5 steps)
- [ ] Quotes list page
- [ ] Quote detail/preview page
- [ ] Rich text editor for content editing

### Phase 3: Orders
- [ ] Orders list + detail pages
- [ ] Convert quote → order flow
- [ ] Auto-create cycles from order

### Phase 4: Extras
- [ ] PDF generation
- [ ] Email/WhatsApp sending
- [ ] Quote expiry notifications
