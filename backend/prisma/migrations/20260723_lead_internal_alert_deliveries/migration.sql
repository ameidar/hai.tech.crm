CREATE TABLE "lead_internal_alert_deliveries" (
  "id" TEXT NOT NULL,
  "lead_appointment_id" TEXT NOT NULL,
  "recipient_type" TEXT NOT NULL,
  "chat_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "message_id" TEXT,
  "last_error" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lead_internal_alert_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_internal_alert_deliveries_lead_appointment_id_recipient_type_key"
  ON "lead_internal_alert_deliveries"("lead_appointment_id", "recipient_type");

CREATE INDEX "lead_internal_alert_deliveries_status_idx"
  ON "lead_internal_alert_deliveries"("status");

CREATE INDEX "lead_internal_alert_deliveries_created_at_idx"
  ON "lead_internal_alert_deliveries"("created_at");

ALTER TABLE "lead_internal_alert_deliveries"
  ADD CONSTRAINT "lead_internal_alert_deliveries_lead_appointment_id_fkey"
  FOREIGN KEY ("lead_appointment_id") REFERENCES "lead_appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
