# תכנית עבודה: הזמנות מוסדיות והצעות מחיר

## סקירה

הרחבת מערכת ה-CRM לתמיכה מלאה בלקוחות מוסדיים: ניהול לקוחות, אנשי קשר, גופים משלמים, הזמנות מוסדיות, הפקת הצעות מחיר ממותגות, שליחה במייל/וואטסאפ, מעקב סטטוסים, וסיוע AI ביצירת ההצעה.

---

## מבנה ישויות חדש

### 1. InstitutionalClient (לקוח מוסדי) — **חדש**
הישות המרכזית. בית ספר, מתנ"ס, עירייה, גוף ציבורי.

```
InstitutionalClient {
  id: UUID
  name: string                    // "מתנ"ס רמות", "עיריית באר שבע"
  type: enum                      // school, community_center, municipality, organization, other
  address?: string
  city?: string
  website?: string
  tax_id?: string                 // ח.פ / מספר עוסק
  notes?: text
  is_active: boolean
  
  // Relations
  paying_body_id?: FK → PayingBody   // גוף משלם (יכול להיות שונה מהלקוח)
  contacts: InstitutionalContact[]
  branches: Branch[]                  // סניפים של הלקוח
  orders: InstitutionalOrder[]
  proposals: Proposal[]
}
```

### 2. PayingBody (גוף משלם) — **חדש**
גוף שמשלם בפועל. יכול להיות הלקוח עצמו או גוף אחר (עירייה, חברה לפיתוח).

```
PayingBody {
  id: UUID
  name: string                    // "עיריית ירושלים", "חברת מתנ"סים"
  tax_id?: string
  address?: string
  city?: string
  payment_terms?: string          // "שוטף + 30", "שוטף + 60"
  billing_email?: string
  billing_contact_name?: string
  billing_contact_phone?: string
  notes?: text
  
  // Relations
  clients: InstitutionalClient[]
}
```

### 3. InstitutionalContact (איש קשר) — **חדש**
אנשי קשר של לקוח מוסדי. כל אחד עם תפקיד שונה.

```
InstitutionalContact {
  id: UUID
  client_id: FK → InstitutionalClient
  name: string
  phone?: string
  email?: string
  role: enum                      // primary, billing, operations, educational_coordinator, principal, other
  title?: string                  // "מנהלת", "רכזת חוגים", "גזברית"
  is_primary: boolean
  notes?: text
}
```

### 4. Proposal (הצעת מחיר) — **חדש**
מסמך הצעת מחיר רשמי שנשלח ללקוח.

```
Proposal {
  id: UUID
  proposal_number: string         // מספר רץ "HT-2026-001"
  client_id: FK → InstitutionalClient
  contact_id: FK → InstitutionalContact  // איש קשר שקיבל את ההצעה
  branch_id?: FK → Branch         // סניף ספציפי (אם רלוונטי)
  
  // פרטי ההצעה
  title: string                   // "הצעת מחיר - סדנאות AI לבית ספר בן גוריון"
  introduction?: text             // פתיח שיווקי
  
  // פריטים
  items: ProposalItem[]           // שורות ההצעה
  
  // תמחור
  subtotal: decimal
  discount_percent?: decimal
  discount_amount?: decimal
  vat_percent: decimal            // 17%
  vat_amount: decimal
  total: decimal
  
  // תנאים
  payment_terms?: string          // "שוטף + 30"
  validity_days: int              // תוקף ההצעה בימים (ברירת מחדל 30)
  valid_until: date
  
  // תוכן שיווקי (AI-generated)
  marketing_content?: text        // המלצות, ניסיון קודם, תיאורי פעילויות
  
  // מצב
  status: enum                    // draft, sent, viewed, accepted, rejected, expired, converted
  sent_at?: timestamp
  sent_via?: enum                 // email, whatsapp, both
  viewed_at?: timestamp
  accepted_at?: timestamp
  rejected_at?: timestamp
  rejection_reason?: string
  
  // מסמך
  pdf_url?: string                // קישור ל-PDF שנוצר
  
  // קשר להזמנה
  converted_order_id?: FK → InstitutionalOrder  // ההזמנה שנוצרה מההצעה
  
  created_by: FK → User
  created_at: timestamp
  updated_at: timestamp
  notes?: text
}
```

### 5. ProposalItem (שורת הצעה) — **חדש**
כל שורה בהצעת מחיר (מחזור/קורס/שירות).

```
ProposalItem {
  id: UUID
  proposal_id: FK → Proposal
  sort_order: int
  
  // פרטים
  course_id?: FK → Course         // קורס מהמערכת (אם רלוונטי)
  description: string             // "סדנת מיינקראפט JavaScript - כיתות ד-ה"
  details?: text                  // פירוט נוסף
  
  // תמחור
  quantity: int                   // מספר מחזורים / מפגשים
  unit_type: enum                 // cycle, meeting, hour, package
  unit_price: decimal
  total: decimal
  
  // פרמטרים של מחזור (אם unit_type = cycle)
  meetings_per_cycle?: int
  meeting_duration_minutes?: int
  day_of_week?: string
  start_time?: string
  students_estimate?: int
}
```

### 6. שינויים בישויות קיימות

**Branch** — הוספת:
```
  client_id?: FK → InstitutionalClient  // שיוך לקוח מוסדי
```

**InstitutionalOrder** — הרחבה:
```
  client_id: FK → InstitutionalClient   // קשר ישיר ללקוח (בנוסף לסניף)
  proposal_id?: FK → Proposal           // ההצעה שהובילה להזמנה
  paying_body_id?: FK → PayingBody      // גוף משלם
  payment_terms?: string
  po_number?: string                    // מספר הזמנת רכש
  invoice_status: enum                  // not_invoiced, partial, invoiced, paid
```

---

## שלבי עבודה

### Phase 1: מודל נתונים ו-API (3-4 ימים)
1. **DB Schema** — Prisma migration עם כל הישויות החדשות
2. **CRUD API** — InstitutionalClient, PayingBody, InstitutionalContact, Proposal, ProposalItem
3. **קישורים** — עדכון Branch ו-InstitutionalOrder עם הקשרים החדשים
4. **Validation** — Zod schemas לכל ישות
5. **מספור אוטומטי** — Proposal number generator (HT-YYYY-NNN)

### Phase 2: הפקת PDF ממותג (2-3 ימים)
1. **Template** — עיצוב מסמך הצעת מחיר רשמי של דרך ההייטק
   - לוגו, צבעים, פונטים
   - Header עם פרטי החברה
   - פרטי הלקוח ואיש קשר
   - טבלת פריטים
   - סיכום כספי (סה"כ, הנחה, מע"מ, סה"כ לתשלום)
   - תנאי תשלום ותוקף
   - חתימה / חותמת
   - תוכן שיווקי (המלצות, פעילויות קודמות)
2. **PDF Engine** — puppeteer או @react-pdf/renderer
3. **אחסון** — שמירה ב-uploads/ + URL במסד
4. **API endpoint** — `GET /api/proposals/:id/pdf`

### Phase 3: שליחה (1-2 ימים)
1. **שליחה במייל** — nodemailer עם template HTML + PDF מצורף
2. **שליחה בוואטסאפ** — Green API עם קישור ל-PDF
3. **מעקב** — עדכון status ל-sent, שמירת sent_at ו-sent_via
4. **API endpoints:**
   - `POST /api/proposals/:id/send-email`
   - `POST /api/proposals/:id/send-whatsapp`

### Phase 4: ממשק ניהול (3-4 ימים)
1. **רשימת לקוחות מוסדיים** — טבלה + חיפוש + סינון
2. **כרטיס לקוח מוסדי** — פרטים, אנשי קשר, סניפים, הזמנות, הצעות
3. **אשף הצעת מחיר** — wizard בשלבים:
   - שלב 1: בחירת לקוח + איש קשר + סניף
   - שלב 2: הוספת פריטים (קורסים, מחזורים, שירותים)
   - שלב 3: תמחור (מחירים, הנחות, תנאי תשלום)
   - שלב 4: תוכן שיווקי (AI-assisted)
   - שלב 5: תצוגה מקדימה + שליחה
4. **רשימת הצעות** — טבלה עם סטטוסים, סינון
5. **תצוגת הצעה** — PDF preview, היסטוריית שליחות

### Phase 5: סיוע AI (2-3 ימים)
1. **AI Proposal Assistant** — endpoint שמקבל פרטי לקוח + קורסים ומייצר:
   - פתיח מותאם ללקוח
   - תיאורי קורסים מותאמים לגיל ולמקום
   - המלצות מפעילויות קודמות דומות
   - תוכן שיווקי (סרטונים, תמונות, לינקים)
2. **Knowledge Base** — קובץ עם תיאורי קורסים, המלצות, case studies
3. **API endpoint** — `POST /api/proposals/:id/ai-generate`
4. **BOT integration** — אפשרות ליצור הצעה דרך Tal (CLI/WhatsApp)

### Phase 6: המרה להזמנה (1 יום)
1. **Convert to Order** — כפתור שהופך הצעה מאושרת להזמנה מוסדית
2. **יצירת מחזורים** — מההצעה → מחזורים + פגישות אוטומטית
3. **קישור** — proposal ↔ order ↔ cycles

---

## API חדשים

```
# Institutional Clients
GET    /api/institutional-clients
POST   /api/institutional-clients
GET    /api/institutional-clients/:id
PUT    /api/institutional-clients/:id
GET    /api/institutional-clients/:id/contacts
POST   /api/institutional-clients/:id/contacts
GET    /api/institutional-clients/:id/proposals
GET    /api/institutional-clients/:id/orders

# Paying Bodies
GET    /api/paying-bodies
POST   /api/paying-bodies
GET    /api/paying-bodies/:id
PUT    /api/paying-bodies/:id

# Contacts
PUT    /api/institutional-contacts/:id
DELETE /api/institutional-contacts/:id

# Proposals
GET    /api/proposals
POST   /api/proposals
GET    /api/proposals/:id
PUT    /api/proposals/:id
DELETE /api/proposals/:id
GET    /api/proposals/:id/pdf
POST   /api/proposals/:id/send-email
POST   /api/proposals/:id/send-whatsapp
POST   /api/proposals/:id/ai-generate
POST   /api/proposals/:id/convert-to-order

# Proposal Items
POST   /api/proposals/:id/items
PUT    /api/proposals/:id/items/:itemId
DELETE /api/proposals/:id/items/:itemId
```

---

## תלויות טכניות

| רכיב | ספרייה | הערות |
|-------|--------|-------|
| PDF | puppeteer / @react-pdf | כולל תמיכה בעברית RTL |
| Email | nodemailer | SMTP של info@hai.tech |
| WhatsApp | Green API | קיים כבר |
| AI | OpenAI API | GPT-4 ליצירת תוכן |
| File Storage | Local uploads/ | עם nginx serve |

---

## ברנץ׳
כל העבודה ב: `feature/institutional-orders`

---

## סדר עדיפויות
1. ☝️ מודל נתונים — בלי זה אין כלום
2. ☝️ CRUD API + ממשק בסיסי — לראות את הנתונים
3. ☝️ הפקת PDF — הליבה של הפיצ'ר
4. שליחה — מייל + וואטסאפ
5. AI — שכבת חכמה
6. המרה — סגירת המעגל

---

## הערות
- Branch קיים כבר ומשמש את המערכת — נוסיף client_id אופציונלי בלי לשבור backwards compatibility
- InstitutionalOrder קיים — נרחיב, לא נחליף
- ה-PDF חייב להיות RTL ולתמוך בעברית כראוי
- הצעות מחיר ישנות לא נמחקות — רק סטטוס expired
