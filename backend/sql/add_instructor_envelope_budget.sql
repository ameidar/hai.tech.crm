-- Migration: Add Instructor Envelope Budget
-- Date: 2026-02-08
-- Description: Adds support for instructor envelope budget (total payment for cycle)
--              and distinguishes between primary and support instructors

-- 1. Add rateSupport to instructors table
ALTER TABLE "instructors" ADD COLUMN IF NOT EXISTS "rate_support" DECIMAL(10, 2);

COMMENT ON COLUMN "instructors"."rate_support" IS 'Hourly rate for support/assistance role';

-- 2. Add primary instructor and total budget to cycles table  
ALTER TABLE "cycles" ADD COLUMN IF NOT EXISTS "primary_instructor_id" TEXT;
ALTER TABLE "cycles" ADD COLUMN IF NOT EXISTS "instructor_total_budget" DECIMAL(10, 2);

COMMENT ON COLUMN "cycles"."primary_instructor_id" IS 'ID of primary instructor (for envelope budget calculation)';
COMMENT ON COLUMN "cycles"."instructor_total_budget" IS 'Total budget for primary instructor (divided by total meetings)';

-- 3. Create instructor_role enum
DO $$ BEGIN
    CREATE TYPE "instructor_role" AS ENUM ('primary', 'support');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 4. Add instructor_role to meetings table
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "instructor_role" "instructor_role";

COMMENT ON COLUMN "meetings"."instructor_role" IS 'Role of instructor in this meeting (primary/support)';

-- Payment Calculation Logic (for reference):
-- ============================================
-- 1. If meeting.instructor_role = 'primary' AND cycle.instructor_total_budget IS NOT NULL:
--    instructor_payment = cycle.instructor_total_budget / cycle.total_meetings
--
-- 2. If meeting.instructor_role = 'support':
--    instructor_payment = instructor.rate_support * hours
--
-- 3. Otherwise (default):
--    instructor_payment = instructor.rate_{activity_type} * hours
