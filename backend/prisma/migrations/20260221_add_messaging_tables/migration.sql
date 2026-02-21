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

-- Seed default templates (3 templates for instructor messaging)
INSERT INTO "message_templates" ("name", "body", "channel") VALUES
  ('תזכורת לשיעור', E'שלום {{instructor_name}} \U0001F44B\nתזכורת לשיעור היום:\n\U0001F4DA {{cycle_name}}\n\U0001F3EB {{branch_name}}\n\U0001F550 שעה: {{meeting_time}}\n\U0001F517 קישור זום: {{zoom_link}}\n\U0001F511 קוד מנהל: {{zoom_host_key}}\nבהצלחה! \U0001F642', 'whatsapp'),
  ('תזכורת מילוי סטטוס', E'שלום {{instructor_name}} \U0001F44B\nנא לעדכן סטטוס השיעור:\n\U0001F4DA {{cycle_name}}\n\U0001F3EB {{branch_name}}\n\U0001F550 שעה: {{meeting_time}}\nעדכן כאן: {{status_link}}', 'whatsapp'),
  ('מלל חופשי', '{{custom_message}}', 'whatsapp')
ON CONFLICT DO NOTHING;
