-- Company expenses: mirror Morning drafts (uploaded, not yet approved) and keep the
-- original foreign-currency amount. Additive only.
ALTER TABLE "company_expenses" ADD COLUMN "original_amount" DECIMAL(12, 2);
ALTER TABLE "company_expenses" ADD COLUMN "is_draft" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "company_expenses_is_draft_idx" ON "company_expenses"("is_draft");
