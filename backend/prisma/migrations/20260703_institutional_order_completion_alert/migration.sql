ALTER TABLE "institutional_orders"
ADD COLUMN "completion_alert_sent_at" TIMESTAMPTZ;

-- Avoid sending historical alerts for orders that were already fully completed
-- before this feature existed. Future completions remain alertable.
UPDATE "institutional_orders" o
SET "completion_alert_sent_at" = NOW()
WHERE EXISTS (
  SELECT 1
  FROM "cycles" c
  WHERE c."institutional_order_id" = o."id"
    AND c."deleted_at" IS NULL
)
AND NOT EXISTS (
  SELECT 1
  FROM "cycles" c
  WHERE c."institutional_order_id" = o."id"
    AND c."deleted_at" IS NULL
    AND c."status" <> 'completed'
);

CREATE INDEX "institutional_orders_completion_alert_sent_at_idx"
ON "institutional_orders"("completion_alert_sent_at");
