ALTER TABLE "meetings"
  ADD COLUMN IF NOT EXISTS "negative_profit_alert_sent_at" TIMESTAMP(3);

UPDATE "meetings"
SET "negative_profit_alert_sent_at" = NOW()
WHERE "status" = 'completed'
  AND "profit" < 0
  AND "negative_profit_alert_sent_at" IS NULL;

CREATE INDEX IF NOT EXISTS "meetings_negative_profit_alert_sent_at_idx"
  ON "meetings"("negative_profit_alert_sent_at");
