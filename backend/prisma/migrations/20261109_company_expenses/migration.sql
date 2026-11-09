-- Company expenses module (additive only).
-- company_expenses: read-only mirror of supplier expenses from Morning (source of truth).
-- recurring_expenses: expected recurring supplier invoices for "missing this month" reminders.

CREATE TABLE "company_expenses" (
  "id"                 TEXT NOT NULL,
  "morning_id"         TEXT NOT NULL,
  "status"             INTEGER,
  "document_type"      TEXT,
  "number"             TEXT,
  "date"               DATE,
  "reporting_date"     DATE,
  "amount"             DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "amount_exclude_vat" DECIMAL(12, 2),
  "vat"                DECIMAL(12, 2),
  "currency"           TEXT,
  "description"        TEXT,
  "supplier_id"        TEXT,
  "supplier_name"      TEXT,
  "category_id"        TEXT,
  "category_title"     TEXT,
  "url"                TEXT,
  "active"             BOOLEAN NOT NULL DEFAULT true,
  "morning_updated_at" TIMESTAMP(3),
  "synced_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "company_expenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_expenses_morning_id_key" ON "company_expenses"("morning_id");
CREATE INDEX "company_expenses_date_idx" ON "company_expenses"("date");
CREATE INDEX "company_expenses_reporting_date_idx" ON "company_expenses"("reporting_date");
CREATE INDEX "company_expenses_supplier_name_idx" ON "company_expenses"("supplier_name");
CREATE INDEX "company_expenses_status_idx" ON "company_expenses"("status");

CREATE TABLE "recurring_expenses" (
  "id"                    TEXT NOT NULL,
  "supplier_id"           TEXT,
  "supplier_name"         TEXT NOT NULL,
  "label"                 TEXT NOT NULL,
  "expected_day_of_month" INTEGER NOT NULL DEFAULT 1,
  "expected_amount"       DECIMAL(12, 2),
  "tolerance_pct"         INTEGER,
  "cadence"               TEXT NOT NULL DEFAULT 'monthly',
  "category_title"        TEXT,
  "status"                TEXT NOT NULL DEFAULT 'suggested',
  "source"                TEXT NOT NULL DEFAULT 'manual',
  "notes"                 TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_expenses_day_range" CHECK ("expected_day_of_month" BETWEEN 1 AND 31),
  CONSTRAINT "recurring_expenses_status_check" CHECK ("status" IN ('suggested', 'active', 'ignored')),
  CONSTRAINT "recurring_expenses_source_check" CHECK ("source" IN ('auto', 'manual'))
);

CREATE INDEX "recurring_expenses_status_idx" ON "recurring_expenses"("status");
