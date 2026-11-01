-- Keep Meta's failure reason for outbound WhatsApp messages
ALTER TABLE "wa_messages" ADD COLUMN IF NOT EXISTS "error_code" INTEGER;
ALTER TABLE "wa_messages" ADD COLUMN IF NOT EXISTS "error_message" TEXT;
CREATE INDEX IF NOT EXISTS "wa_messages_failed_created_at_idx" ON "wa_messages" ("created_at") WHERE "status" = 'failed';
