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
  ('תזכורת לשיעור', 'שלום {{instructor_name}}, תזכורת לשיעור היום: {{cycle_name}} | {{branch_name}} | שעה: {{meeting_time}} | זום: {{zoom_link}}', 'whatsapp'),
  ('תזכורת מילוי סטטוס', 'שלום {{instructor_name}}, נא לעדכן סטטוס השיעור: {{cycle_name}} | {{branch_name}} | שעה: {{meeting_time}} | עדכן כאן: {{status_link}}', 'whatsapp'),
  ('מלל חופשי', '{{custom_message}}', 'whatsapp')
ON CONFLICT DO NOTHING;
