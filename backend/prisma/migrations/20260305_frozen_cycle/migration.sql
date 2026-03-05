-- Add frozen status to CycleStatus enum
ALTER TYPE "CycleStatus" ADD VALUE IF NOT EXISTS 'frozen';

-- Add frozen fields to cycles table
ALTER TABLE "cycles"
  ADD COLUMN IF NOT EXISTS "frozen_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "frozen_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "resume_date" DATE;
