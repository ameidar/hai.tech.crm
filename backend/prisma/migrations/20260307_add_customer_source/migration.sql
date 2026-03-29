-- Add source field to customers table
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "source" TEXT;
