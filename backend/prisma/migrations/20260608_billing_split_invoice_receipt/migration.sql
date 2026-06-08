-- Split tax invoice / receipt support.
-- Distinguish a combined 320 (חשבונית מס+קבלה) from a standalone 305 (חשבונית מס בלבד),
-- track the proforma source (issued via API vs linked from a manually-issued Morning doc),
-- and let a payment carry the Morning 400 receipt it was issued as.
ALTER TABLE "billing_periods" ADD COLUMN "tax_invoice_type" INTEGER;
ALTER TABLE "billing_periods" ADD COLUMN "proforma_source" TEXT;

ALTER TABLE "billing_payments" ADD COLUMN "morning_receipt_id" TEXT;
ALTER TABLE "billing_payments" ADD COLUMN "morning_receipt_number" INTEGER;
ALTER TABLE "billing_payments" ADD COLUMN "morning_receipt_url" TEXT;
