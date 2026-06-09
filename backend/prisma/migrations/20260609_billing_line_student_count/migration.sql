-- Lock the per-child roster count used for each billing line at generation time, so a
-- later cancellation can never rewrite an already-billed month's invoice.
-- Nullable: fixed-price and manually-added lines leave it null.
ALTER TABLE "billing_period_lines"
  ADD COLUMN "student_count" INTEGER;
