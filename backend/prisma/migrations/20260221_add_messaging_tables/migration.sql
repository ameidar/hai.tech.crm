-- CreateTable: message_templates
CREATE TABLE IF NOT EXISTS "message_templates" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "subject" TEXT,
  "channel" TEXT NOT NULL DEFAULT 'whatsapp',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: message_logs
CREATE TABLE IF NOT EXISTS "message_logs" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "instructor_id" TEXT REFERENCES "instructors"("id") ON DELETE SET NULL,
  "template_id" TEXT,
  "channel" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT,
  "body" TEXT,
  "status" TEXT NOT NULL DEFAULT 'sent',
  "error_message" TEXT,
  "sent_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "meeting_id" TEXT REFERENCES "meetings"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- Seed default templates
INSERT INTO "message_templates" ("name", "body", "channel") VALUES
  ('תזכורת פגישה מחר', 'שלום {{instructor_name}}, תזכורת: מחר יש לך שיעור "{{cycle_name}}" בסניף {{branch_name}} בשעה {{meeting_time}}. בהצלחה!', 'whatsapp'),
  ('קישור זום לפגישה', 'שלום {{instructor_name}}, הנה קישור הזום לשיעור "{{cycle_name}}" בשעה {{meeting_time}}: {{zoom_link}}', 'whatsapp'),
  ('הזמנה למערכת', 'שלום {{instructor_name}}, הוזמנת להתחבר למערכת ניהול השיעורים של דרך ההייטק. לחץ כאן לכניסה: {{login_link}}', 'whatsapp'),
  ('עדכון כללי', '{{custom_message}}', 'whatsapp'),
  ('הזמנה למערכת - אימייל', 'שלום {{instructor_name}}, הוזמנת להתחבר למערכת ניהול השיעורים של דרך ההייטק.', 'email')
ON CONFLICT DO NOTHING;
