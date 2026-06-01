-- Add payment date + manager approval to cycle expenses.
-- payment_date drives which month the expense is attributed to in payment reports.
-- status (reuses existing "expense_status" enum) gates the expense behind manager approval.

ALTER TABLE "cycle_expenses"
  ADD COLUMN "payment_date" DATE,
  ADD COLUMN "status" "expense_status" NOT NULL DEFAULT 'pending',
  ADD COLUMN "reviewed_by" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "rejection_reason" TEXT;

-- Existing expenses predate the approval flow — treat them as already approved.
UPDATE "cycle_expenses" SET "status" = 'approved';

ALTER TABLE "cycle_expenses"
  ADD CONSTRAINT "cycle_expenses_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cycle_expenses_status_idx" ON "cycle_expenses"("status");
CREATE INDEX "cycle_expenses_payment_date_idx" ON "cycle_expenses"("payment_date");
