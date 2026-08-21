# WhatsApp Cloud Templates - Leads and Reminders

These templates must exist and be approved in the Meta WhatsApp Manager before enabling the reminder flows in production.

## Lead Templates

### `lead_admin_new_lead`

Internal admin alert for a new CRM lead. Send only to direct phone recipients such as Ami/Kim; regular WhatsApp groups still require Green API unless Meta Groups API becomes available for the number.

Body:

```text
ליד חדש נכנס ל-CRM.
שם: {{1}}
טלפון: {{2}}
מייל: {{3}}
ילד/ה: {{4}}
תחום עניין: {{5}}
מקור: {{6}}
פתחו את הליד כאן: {{7}}
דרך ההייטק
```

Variables:

1. Lead name
2. Lead phone
3. Lead email
4. Child name
5. Interest/course
6. Source
7. CRM lead link

Env:

```text
LEAD_ADMIN_WA_TEMPLATE_ENABLED=true
LEAD_ADMIN_WA_TEMPLATE_NAME=lead_admin_new_lead
LEAD_ADMIN_WA_TEMPLATE_RECIPIENTS=0528746137,05XXXXXXXX
LEAD_ADMIN_WA_PHONE_NUMBER_ID=<optional override>
LEAD_ADMIN_GREEN_FALLBACK_ENABLED=true
```

### `lead_welcome_course_interest`

Body:

```text
היי {{1}}, קיבלנו את ההתעניינות שלך בדרך ההייטק.
נציג יחזור אליך עם פרטים והתאמה לקורס המתאים.
```

Variables:

1. First name

### `lead_welcome_trial_or_campaign`

Body:

```text
היי {{1}}, תודה שהתעניינת ב-{{2}}.
קיבלנו את הפרטים ונחזור אליך בהקדם עם האפשרויות הקרובות.
```

Variables:

1. First name
2. Interest/campaign name

## Parent Reminder Templates

### `parent_lesson_reminder`

Status on 2026-07-25: approved in Meta.

Body:

```text
שלום {{1}},
תזכורת: ל{{2}} יש שיעור {{3}} מחר, {{4}}, בשעה {{5}}.

מיקום: {{6}}
מדריך/ה: {{7}}

{{8}}

נתראה בשיעור,
דרך ההייטק
```

Variables:

1. Parent name
2. Student name
3. Class/course name
4. Date
5. Time
6. Location
7. Instructor name
8. Zoom/link note

### `parent_online_lesson_reminder_24h`

Optional newer split template. If this template is not approved, leave `PARENT_ONLINE_REMINDER_WA_TEMPLATE_NAME` empty and the CRM will use `parent_lesson_reminder` for online lessons too.

Body:

```text
שלום {{1}}, תזכורת: ל-{{2}} יש שיעור אונליין {{3}} מחר בשעה {{4}}.
קישור לזום: {{5}}
מומלץ להתחבר כמה דקות לפני תחילת השיעור.
```

Variables:

1. Parent name
2. Student name
3. Class/course name
4. Time
5. Zoom link

## Instructor Reminder Templates

### `instructor_daily_schedule`

Body:

```text
שלום {{1}}, תזכורת לשיעורים שלך היום:
{{2}}
לינק לדיווח נוכחות/סטטוס: {{3}}
בהצלחה, דרך ההייטק
```

Variables:

1. Instructor name
2. Meeting list
3. Instructor portal link

### `instructor_pre_lesson_60m`

Body:

```text
שלום {{1}}, תזכורת לשיעור שמתחיל בעוד כשעה:
{{2}}
מיקום: {{3}}
שעה: {{4}}
לינק לפגישה: {{5}}
```

Variables:

1. Instructor name
2. Meeting/cycle name
3. Location
4. Time
5. Magic meeting link

### `instructor_status_check`

Body:

```text
שלום {{1}}, האם השיעור של היום התקיים?
קורס: {{2}}
שעה: {{3}}
אפשר לעדכן כאן או דרך הקישור: {{4}}
```

Variables:

1. Instructor name
2. Cycle name
3. Time
4. Magic meeting link

Recommended quick replies:

- כן, התקיים
- לא התקיים

### `instructor_last_lesson_reminder`

Body:

```text
שלום {{1}}, נותר שיעור אחד בלבד לסיום המחזור "{{2}}" בתאריך {{3}}.
אנא ודא/י שכל פרטי הכיתה מעודכנים לקראת השיעור האחרון.
```

Variables:

1. Instructor name
2. Cycle name
3. Last lesson date

## Management Reminder Template

### `management_unresolved_meetings`

Body:

```text
פגישות ללא דיווח סטטוס מ-{{1}}:
סה"כ {{2}} פגישות.
{{3}}
לבדיקה ב-CRM: {{4}}
```

Variables:

1. Date label
2. Unresolved meeting count
3. Meeting details
4. CRM link
