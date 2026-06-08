-- Open-proforma alert system (PR 3)

-- Per-institution payment terms: due date = end of issue month + this many days.
ALTER TABLE "institutional_orders"
  ADD COLUMN "payment_terms_days" INTEGER NOT NULL DEFAULT 30;

-- Throttle timestamp for overdue-unpaid alerts (null = never alerted).
ALTER TABLE "billing_periods"
  ADD COLUMN "last_open_proforma_alert_at" TIMESTAMP(3);
