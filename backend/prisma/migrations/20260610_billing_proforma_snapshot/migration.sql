-- Freeze the proforma (חשבון עסקה) line items + VAT + gross total at issue time.
-- Downstream documents (320/305/400) are rebuilt from this snapshot instead of the live
-- billing lines, so a tax invoice/receipt can never silently differ from its proforma.
-- Nullable: legacy periods (issued before this column) and manual-Morning proformas
-- backfill it lazily from the Morning document on first downstream issue.
ALTER TABLE "billing_periods"
  ADD COLUMN "proforma_snapshot" JSONB;
