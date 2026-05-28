-- Separate Morning document header/title text from footer remarks.
ALTER TABLE "billing_periods"
  ADD COLUMN IF NOT EXISTS "document_title" TEXT;
