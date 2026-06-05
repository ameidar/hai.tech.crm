-- Operations staff + self-reported work hours.
-- 1. New "operations" user role for ops staff who log in to report their own hours.
-- 2. Instructor gets a "kind" discriminator + a single "hourly_rate" used for ops staff.
-- 3. work_hour_entries: one self-reported (date, hours) row per ops staff member,
--    gated behind admin/manager approval before it counts in the monthly salary report.

-- New role value (Postgres requires ADD VALUE outside a transaction; safe if already present)
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'operations';

-- Instructor: discriminator + ops hourly rate
ALTER TABLE "instructors"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'instructor',
  ADD COLUMN "hourly_rate" DECIMAL(10, 2);

CREATE TABLE "work_hour_entries" (
  "id"               TEXT NOT NULL,
  "instructor_id"    TEXT NOT NULL,
  "work_date"        DATE NOT NULL,
  "hours"            DECIMAL(5, 2) NOT NULL,
  "description"      TEXT,
  "status"           "expense_status" NOT NULL DEFAULT 'pending',
  "reviewed_by"      TEXT,
  "reviewed_at"      TIMESTAMP(3),
  "rejection_reason" TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "work_hour_entries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "work_hour_entries"
  ADD CONSTRAINT "work_hour_entries_instructor_id_fkey"
  FOREIGN KEY ("instructor_id") REFERENCES "instructors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_hour_entries"
  ADD CONSTRAINT "work_hour_entries_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "work_hour_entries_instructor_id_idx" ON "work_hour_entries"("instructor_id");
CREATE INDEX "work_hour_entries_work_date_idx" ON "work_hour_entries"("work_date");
CREATE INDEX "work_hour_entries_status_idx" ON "work_hour_entries"("status");
