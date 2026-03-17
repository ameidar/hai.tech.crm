-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "lead_status" TEXT DEFAULT 'new';
