-- Add refund and credit invoice fields to registrations
ALTER TABLE "registrations"
  ADD COLUMN IF NOT EXISTS "refund_amount" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "refund_date" DATE,
  ADD COLUMN IF NOT EXISTS "credit_invoice_link" TEXT;
