-- Sales workflow fields for lead appointments.
ALTER TABLE "lead_appointments"
  ADD COLUMN "sales_status" TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN "assigned_to_id" TEXT,
  ADD COLUMN "next_follow_up_at" TIMESTAMP(3),
  ADD COLUMN "last_contact_result" TEXT,
  ADD COLUMN "last_contacted_at" TIMESTAMP(3);

ALTER TABLE "lead_appointments"
  ADD CONSTRAINT "lead_appointments_assigned_to_id_fkey"
  FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "lead_appointments_sales_status_idx" ON "lead_appointments"("sales_status");
CREATE INDEX "lead_appointments_assigned_to_id_idx" ON "lead_appointments"("assigned_to_id");
CREATE INDEX "lead_appointments_next_follow_up_at_idx" ON "lead_appointments"("next_follow_up_at");

-- Immutable activity log for lead work.
CREATE TABLE "lead_activities" (
  "id" TEXT NOT NULL,
  "lead_appointment_id" TEXT NOT NULL,
  "user_id" TEXT,
  "type" TEXT NOT NULL,
  "result" TEXT,
  "note" TEXT,
  "next_follow_up_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lead_activities"
  ADD CONSTRAINT "lead_activities_lead_appointment_id_fkey"
  FOREIGN KEY ("lead_appointment_id") REFERENCES "lead_appointments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_activities"
  ADD CONSTRAINT "lead_activities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "lead_activities_lead_appointment_id_idx" ON "lead_activities"("lead_appointment_id");
CREATE INDEX "lead_activities_user_id_idx" ON "lead_activities"("user_id");
CREATE INDEX "lead_activities_created_at_idx" ON "lead_activities"("created_at");
