ALTER TABLE "meetings"
  ADD COLUMN "registration_id" TEXT;

CREATE INDEX "meetings_registration_id_idx"
  ON "meetings"("registration_id");

ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_registration_id_fkey"
  FOREIGN KEY ("registration_id") REFERENCES "registrations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
