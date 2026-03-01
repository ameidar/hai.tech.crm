-- AddColumn callDirection to lead_appointments
ALTER TABLE "lead_appointments" ADD COLUMN IF NOT EXISTS "call_direction" TEXT NOT NULL DEFAULT 'outbound';
