# CODEBASE.md — HaiTech CRM

> מפה מלאה לעבודה עם AI. מעדכנים כשמוסיפים feature משמעותי.

## Stack
- **Backend:** Node.js + TypeScript + Express + Prisma ORM
- **Frontend:** React + Vite + Tailwind CSS
- **DB:** PostgreSQL (Prisma schema)
- **Cache/Queue:** Redis (email queue)
- **Infra:** Docker (prod), systemd dev service
- **Dev:** `http://187.124.2.69:3002` | **Prod:** `https://crm.orma-ai.com`

---

## DB Models (Prisma)

| Model | תיאור |
|-------|--------|
| `User` | משתמשי מערכת — roles: admin, manager, instructor, sales |
| `Branch` | סניפים |
| `Course` | קורסים (Minecraft, Scratch, Python...) |
| `Cycle` | מחזור = קורס + סניף + מדריך + לו"ז |
| `Meeting` | שיעור בודד בתוך מחזור |
| `Attendance` | נוכחות תלמיד בשיעור |
| `Student` | תלמיד (שייך ל-Customer) |
| `Customer` | הורה/לקוח, כולל lmsUsername/lmsPassword |
| `Registration` | רישום תלמיד למחזור |
| `Payment` | תשלום — wooOrderId, invoiceUrl, greeninvoice_data |
| `Instructor` | מדריך — rates, schedule, phone |
| `LeadAppointment` | ליד שנוצר מ-VAPI call (inbound/outbound) |
| `UpsellLead` | ליד מ-landing page / campaign |
| `Campaign` | קמפיין שיווקי — WA + Email |
| `CampaignRecipient` | נמען לקמפיין — clicked_at, click_count |
| `Quote` | הצעת מחיר |
| `QuoteItem` | פריט בהצעת מחיר |
| `InstitutionalOrder` | הזמנה מוסדית |
| `WaConversation` | שיחת WhatsApp |
| `WaMessage` | הודעה בשיחת WA |
| `WaCallbackRequest` | callback request מ-WA webhook |
| `MeetingChangeRequest` | בקשת שינוי שיעור מהורה |
| `CancellationRequest` | בקשת ביטול |
| `CycleExpense` / `MeetingExpense` | הוצאות |
| `FileAttachment` | קבצים מצורפים |
| `AuditLog` | לוג שינויים |
| `SavedView` | תצוגות שמורות (פילטרים) |

---

## Backend Routes (`backend/src/routes/`)

### Core
| קובץ | Prefix | תיאור |
|------|--------|--------|
| `auth.ts` | `/api/auth` | login, logout, refresh, reset-password |
| `users.ts` → `system-users.ts` | `/api/system-users` | ניהול משתמשי מערכת |
| `branches.ts` | `/api/branches` | סניפים CRUD |
| `courses.ts` | `/api/courses` | קורסים CRUD |
| `cycles.ts` | `/api/cycles` | מחזורים CRUD + filter |
| `meetings.ts` | `/api/meetings` | שיעורים CRUD + bulk edit |
| `students.ts` | `/api/students` | תלמידים CRUD |
| `customers.ts` | `/api/customers` | לקוחות CRUD + payments |
| `instructors.ts` | `/api/instructors` | מדריכים CRUD + report |
| `registrations.ts` | `/api/registrations` | רישומים |
| `attendance.ts` | `/api/attendance` | נוכחות |

### Payments & Finance
| קובץ | תיאור |
|------|--------|
| `payments.ts` | `/api/payments` — CRUD, create-link (WooCommerce), sync-woo, PATCH invoiceUrl |
| `quotes.ts` + `public-quote.ts` | `/api/quotes` — הצעות מחיר + public view |
| `expenses.ts` | `/api/expenses` — הוצאות מחזורים |
| `institutional-orders.ts` | `/api/institutional-orders` |

### AI & Automation
| קובץ | תיאור |
|------|--------|
| `vapi-tools.ts` | `/api/vapi-tools` — כלי AI לשיחות VAPI (tool calls) |
| `vapi-webhook.ts` | `/api/vapi-webhook` — webhook מ-VAPI (end-of-call report) |
| `ai-chat.ts` | `/api/ai-chat` — chat widget בתוך CRM (OpenAI) |
| `campaigns.ts` | `/api/campaigns` — קמפיינים + UTM tracking |
| `campaign-leads.ts` | `/api/campaign-leads` — לידים מ-landing pages |
| `upsell-leads.ts` | `/api/upsell-leads` — upsell leads |
| `lead-appointments.ts` | `/api/lead-appointments` — לידים מ-VAPI |

### WhatsApp
| קובץ | תיאור |
|------|--------|
| `whatsapp.ts` | `/api/whatsapp` — Inbox: שיחות, הודעות, templates, SSE |
| `webhook.ts` | `/api/webhook` — WA Cloud API webhook (inbound messages) |
| `messaging.ts` | `/api/messaging` — send WA/email per customer |

### Zoom & Media
| קובץ | תיאור |
|------|--------|
| `zoom.ts` | `/api/zoom` — list recordings, get info |
| `zoom-webhook.ts` | `/api/zoom-webhook` — recording.completed → transcription |
| `files.ts` | `/api/files` — upload/download file attachments |

### Reports & Views
| קובץ | תיאור |
|------|--------|
| `reports.ts` | `/api/reports` — דוחות + sync-woo + instructor report |
| `forecast.ts` | `/api/forecast` — תחזית הכנסות |
| `audit.ts` | `/api/audit` — audit log |

### Other
| קובץ | תיאור |
|------|--------|
| `meeting-requests.ts` | `/api/meeting-requests` — בקשות שינוי שיעור מהורים |
| `public-cancel.ts` | `/api/public-cancel` — ביטול שיעור (ציבורי, ללא auth) |
| `public-meeting.ts` | `/api/public-meeting` — פרטי שיעור ציבורי |
| `instructor-magic.ts` | `/api/instructor-magic` — קישור קסם למדריך (ללא login) |
| `invite.ts` | `/api/invite` — הזמנת משתמש חדש |
| `parent-app.ts` | `/api/parent-app` — app הורים (mobile) |
| `communication.ts` | `/api/communication` — שליחת WA/email bulk |
| `email.ts` | `/api/email` — שליחת מייל ידני |

---

## Services (`backend/src/services/`)

| קובץ | תיאור |
|------|--------|
| `vapi.ts` | VAPI call management (outbound calls, JWT auth) |
| `messaging.ts` | WA Cloud API + Green API sender |
| `zoom.ts` | Zoom OAuth + recording download |
| `transcription.ts` | Whisper-based transcription |
| `campaigns.service.ts` | שליחת קמפיין (WA + email) |
| `campaignAI.service.ts` | Perplexity + GPT-4o → variants |
| `quotes.service.ts` | חישוב הצעות מחיר |
| `quote-ai.service.ts` | GPT-4o → הצעת מחיר חכמה |
| `instructor-reminder.service.ts` | תזכורות ל-WhatsApp למדריכים (cron) |
| `whatsapp-reminder.service.ts` | WA poll + auto-cancel אחרי אי-דיווח |
| `instructorReport.service.ts` | דוח חודשי מדריכים → Excel → Email |
| `cancellation-scheduler.ts` | ביטול אוטומטי של שיעורים לא-מדווחים |
| `cycle-completion.ts` | סיום מחזורים אוטומטי |
| `replacement-meeting.ts` | יצירת שיעור חלופי |
| `google-calendar.ts` | Google Calendar sync |
| `email/` | queue, sender, templates, scheduler |
| `notifications.ts` | שליחת התראות כלליות |
| `video.service.ts` | עיבוד וידאו |

---

## Frontend Pages (`frontend/src/pages/`)

| קובץ | תיאור |
|------|--------|
| `Dashboard.tsx` | לוח בקרה ראשי (admin/manager) |
| `InstructorDashboard.tsx` | לוח מדריך |
| `Customers.tsx` / `CustomerDetail.tsx` | לקוחות |
| `Students.tsx` | תלמידים |
| `Cycles.tsx` / `CycleDetail.tsx` | מחזורים |
| `Meetings.tsx` | שיעורים (טבלה + bulk edit) |
| `Branches.tsx` | סניפים |
| `Courses.tsx` | קורסים |
| `Instructors.tsx` | מדריכים |
| `Reports.tsx` | דוחות + sync WooCommerce |
| `Campaigns.tsx` | קמפיינים שיווקיים |
| `WhatsAppInbox.tsx` | Inbox WA — שיחות + templates + SSE |
| `LeadAppointments.tsx` | לידים מ-VAPI |
| `Quotes.tsx` / `QuoteDetail.tsx` / `QuoteWizard.tsx` | הצעות מחיר |
| `InstitutionalOrders.tsx` | הזמנות מוסדיות |
| `SystemUsers.tsx` | משתמשי מערכת |
| `AuditLog.tsx` | לוג שינויים |
| `Login.tsx` / `ResetPassword.tsx` / `InviteSetup.tsx` | Auth |
| `CampaignLanding.tsx` | landing page לקמפיין (ציבורי) |
| `MeetingStatus.tsx` | סטטוס שיעור (ציבורי) |
| `PublicCancelForm.tsx` / `PublicQuoteView.tsx` | דפים ציבוריים |
| `instructor/Mobile*.tsx` | ממשק mobile למדריכים |

---

## Integrations

| שירות | קובץ/מיקום | תיאור |
|--------|------------|--------|
| **WA Cloud API** | `services/messaging.ts` | שליחת הודעות, templates |
| **Green API** | `services/messaging.ts` | שליחת WA ל-CRM users (polls) |
| **VAPI** | `services/vapi.ts`, `routes/vapi-tools.ts` | שיחות AI אוטומטיות |
| **OpenAI (GPT-4o)** | `routes/ai-chat.ts`, `services/campaignAI.service.ts` | AI chat + campaign content |
| **Perplexity** | `services/campaignAI.service.ts` | מחקר שוק לקמפיינים |
| **Zoom** | `services/zoom.ts`, `routes/zoom-webhook.ts` | הקלטות + תמלול |
| **WooCommerce** | `routes/payments.ts` | תשלום online (קורסים דיגיטליים) |
| **Morning (GreenInvoice)** | `routes/payments.ts` | חשבוניות |
| **Gmail (SMTP)** | `services/email/sender.ts` | שליחת מיילים |
| **Google Calendar** | `services/google-calendar.ts` | סנכרון לו"ז |
| **Fireberry** | legacy (API key שמור) | מחליף בהדרגה |

---

## Middleware (`backend/src/middleware/`)

| קובץ | תיאור |
|------|--------|
| `auth.ts` | JWT validation + user attach to req |
| `softDelete.ts` | מסנן deleted records אוטומטית |
| `devReadOnly.ts` | חוסם write operations ב-main branch |
| `errorHandler.ts` | global error handler |

---

## Cron Jobs

| Service | תזמון | תיאור |
|---------|--------|--------|
| `instructor-reminder.service` | ערב לפני שיעור | WA reminder למדריכים |
| `whatsapp-reminder.service` | בוקר אחרי שיעור | poll אם התקיים + auto-cancel |
| `cancellation-scheduler` | כל שעה | ביטול שיעורים ישנים ללא סטטוס |
| `instructorReport.service` | 1 לחודש 08:00 IL | דוח Excel → hila@, ami@, inna@ |
| `cycle-completion` | יומי | סיום מחזורים שנגמרו |
| `email/scheduler` | תמידי | email queue processing |

---

## Auth & Roles

```
admin    → גישה מלאה
manager  → כמו admin, פחות system settings
instructor → מחזורים שלו בלבד + attendance
sales    → WhatsApp Inbox + customers בלבד
```

JWT + Bearer token. Magic link למדריכים (ללא סיסמא).

---

## הערות טכניות חשובות

- **Route order חשוב!** `/download/:id` לפני `/:entityType/:entityId`
- **multer encoding:** `Buffer.from(name,'latin1').toString('utf8')`
- **frontend/dist** בבעלות root (Docker) → build ל-`/tmp/` ואז copy ידני
- **`start-dev.sh` חסום מ-main** — תמיד לעבוד מ-`dev` branch
- **VAPI:** לא להפעיל כשsource==='whatsapp' (כפילות)
- **WooCommerce on-hold = שולם** (לא processing)
