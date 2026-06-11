-- Snapshot the Morning client (לכבוד) name as it appeared on the issued/linked document.
-- The monthly-accounts list shows this for the institution (from the most-recently-issued
-- period) so the displayed name matches Morning exactly; falls back to order_name when null.
-- Nullable: drafts and legacy issued periods backfill it lazily / via the backfill script.
ALTER TABLE "billing_periods"
  ADD COLUMN "morning_client_name" TEXT;
