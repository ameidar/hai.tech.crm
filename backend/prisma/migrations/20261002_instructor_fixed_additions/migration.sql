-- Instructor fixed monthly additions ("תוספות קבועות"), e.g. a fixed 2,500 ₪ net
-- coordination fee paid every month. Months are stored as the first day of the month;
-- end_month is inclusive and NULL means open-ended. Included automatically in the
-- monthly instructor salary report for every month in range.

CREATE TABLE "instructor_fixed_additions" (
  "id"            TEXT NOT NULL,
  "instructor_id" TEXT NOT NULL,
  "description"   TEXT NOT NULL,
  "amount"        DECIMAL(10, 2) NOT NULL,
  "is_net"        BOOLEAN NOT NULL DEFAULT true,
  "start_month"   DATE NOT NULL,
  "end_month"     DATE,
  "notes"         TEXT,
  "created_by"    TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "deleted_at"    TIMESTAMP(3),
  "deleted_by"    TEXT,
  CONSTRAINT "instructor_fixed_additions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instructor_fixed_additions_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "instructor_fixed_additions_month_range" CHECK ("end_month" IS NULL OR "end_month" >= "start_month")
);

ALTER TABLE "instructor_fixed_additions"
  ADD CONSTRAINT "instructor_fixed_additions_instructor_id_fkey"
  FOREIGN KEY ("instructor_id") REFERENCES "instructors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "instructor_fixed_additions"
  ADD CONSTRAINT "instructor_fixed_additions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "instructor_fixed_additions_instructor_id_idx" ON "instructor_fixed_additions"("instructor_id");
CREATE INDEX "instructor_fixed_additions_start_month_idx" ON "instructor_fixed_additions"("start_month");
