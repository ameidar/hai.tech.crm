ALTER TABLE "attendance"
  ADD COLUMN "institutional_absence_alert_sent_at" TIMESTAMP(3);

ALTER TABLE "meetings"
  ADD COLUMN "institutional_attendance_missing_alert_sent_at" TIMESTAMP(3);

-- Do not backfill old absences into Kim's WhatsApp. Existing institutional
-- absences are marked as already handled; newly recorded absences stay NULL.
UPDATE "attendance" a
SET "institutional_absence_alert_sent_at" = NOW()
FROM "meetings" m
JOIN "cycles" c ON c."id" = m."cycle_id"
WHERE a."meeting_id" = m."id"
  AND a."status" = 'absent'
  AND c."institutional_order_id" IS NOT NULL;

CREATE INDEX "attendance_institutional_absence_alert_sent_at_idx"
  ON "attendance"("institutional_absence_alert_sent_at");

-- Do not send "missing attendance" alerts for meetings completed before this
-- feature was deployed.
UPDATE "meetings" m
SET "institutional_attendance_missing_alert_sent_at" = NOW()
FROM "cycles" c
WHERE m."cycle_id" = c."id"
  AND m."status" = 'completed'
  AND c."institutional_order_id" IS NOT NULL;

CREATE INDEX "meetings_institutional_attendance_missing_alert_sent_at_idx"
  ON "meetings"("institutional_attendance_missing_alert_sent_at");
