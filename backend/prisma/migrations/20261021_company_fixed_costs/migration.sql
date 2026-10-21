-- Company-level fixed monthly costs (e.g. salaried staff such as office/coordination
-- employees) that are not tied to meetings. Shown per month in the dashboard forecast
-- and subtracted from profit. Amount = full monthly cost to the company.

CREATE TABLE "company_fixed_costs" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "category"    TEXT NOT NULL DEFAULT 'staff',
  "amount"      DECIMAL(10, 2) NOT NULL,
  "start_month" DATE NOT NULL,
  "end_month"   DATE,
  "month_overrides" JSONB,
  "notes"       TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "company_fixed_costs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_fixed_costs_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "company_fixed_costs_month_range" CHECK ("end_month" IS NULL OR "end_month" >= "start_month")
);

CREATE INDEX "company_fixed_costs_start_month_idx" ON "company_fixed_costs"("start_month");

-- Seed with the global salaries that were hard-coded in routes/morning.ts
-- (GLOBAL_MONTHLY_SALARIES), including their per-month overrides, so the Morning
-- financials view keeps showing the same numbers and the forecast now includes them.
INSERT INTO "company_fixed_costs" ("id", "name", "category", "amount", "start_month", "end_month", "month_overrides", "notes", "updated_at") VALUES
  ('8f6c2a8e-4c1b-4b6e-9a51-1d7c0e2f3a01', 'הילה', 'staff', 13000, DATE '2020-01-01', NULL, '{"2026-03": 8000, "2026-04": 3000}', 'משכורת גלובלית - עלות מעסיק', CURRENT_TIMESTAMP),
  ('8f6c2a8e-4c1b-4b6e-9a51-1d7c0e2f3a02', 'אור', 'staff', 13000, DATE '2020-01-01', NULL, '{"2026-03": 8000, "2026-04": 8000}', 'משכורת גלובלית - עלות מעסיק', CURRENT_TIMESTAMP);
