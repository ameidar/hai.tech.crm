-- Add LMS credentials fields to customers table
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "lms_username" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "lms_password" TEXT;
