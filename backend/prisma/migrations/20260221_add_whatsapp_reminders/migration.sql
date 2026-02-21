-- WhatsApp status reminder tracking
CREATE TABLE IF NOT EXISTS "whatsapp_status_reminders" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "meeting_id" TEXT REFERENCES "meetings"("id") ON DELETE CASCADE,
  "instructor_id" TEXT REFERENCES "instructors"("id") ON DELETE CASCADE,
  "instructor_phone" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'status_check',
  "sent_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "response" TEXT,
  "responded_at" TIMESTAMPTZ,
  "auto_completed" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "whatsapp_status_reminders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_wsr_meeting" ON "whatsapp_status_reminders"("meeting_id");
CREATE INDEX IF NOT EXISTS "idx_wsr_phone" ON "whatsapp_status_reminders"("instructor_phone");
CREATE INDEX IF NOT EXISTS "idx_wsr_sent_at" ON "whatsapp_status_reminders"("sent_at");
