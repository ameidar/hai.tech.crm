-- AlterTable: Add rateSupport to instructors
ALTER TABLE "instructors" ADD COLUMN "rate_support" DECIMAL(10, 2);

-- AlterTable: Add primary instructor and total budget to cycles
ALTER TABLE "cycles" ADD COLUMN "primary_instructor_id" TEXT;
ALTER TABLE "cycles" ADD COLUMN "instructor_total_budget" DECIMAL(10, 2);

-- CreateEnum: instructor_role
DO $$ BEGIN
    CREATE TYPE "instructor_role" AS ENUM ('primary', 'support');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable: Add instructor_role to meetings
ALTER TABLE "meetings" ADD COLUMN "instructor_role" "instructor_role";

-- Comment: Payment calculation logic
-- When calculating instructor payment:
-- 1. If meeting.instructor_role = 'primary' AND cycle.instructor_total_budget IS NOT NULL:
--    payment = cycle.instructor_total_budget / cycle.total_meetings
-- 2. If meeting.instructor_role = 'support':
--    payment = instructor.rate_support * hours
-- 3. Otherwise (default):
--    payment = instructor.rate_{activity_type} * hours
