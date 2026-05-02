-- Tax/address fields on institutional orders (manual fill — see UI)
ALTER TABLE "institutional_orders"
  ADD COLUMN "tax_id"  TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "city"    TEXT,
  ADD COLUMN "zip"     TEXT;

-- Billing status enum
CREATE TYPE "BillingStatus" AS ENUM ('draft', 'issued', 'cancelled');

-- One row per (institution × billed month). Holds the proforma metadata.
CREATE TABLE "billing_periods" (
  "id"                       TEXT          NOT NULL,
  "institutional_order_id"   TEXT          NOT NULL,
  "month"                    DATE          NOT NULL,
  "status"                   "BillingStatus" NOT NULL DEFAULT 'draft',
  "total_amount"             DECIMAL(10,2) NOT NULL DEFAULT 0,
  "notes"                    TEXT,
  "send_by_email"            BOOLEAN       NOT NULL DEFAULT false,
  "generated_at"             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generated_by_id"          TEXT,
  "approved_at"              TIMESTAMP(3),
  "approved_by_id"           TEXT,
  "issued_at"                TIMESTAMP(3),
  "issued_by_id"             TEXT,
  "morning_doc_id"           TEXT,
  "morning_doc_number"       INTEGER,
  "morning_doc_url"          TEXT,
  "morning_doc_type"         INTEGER,
  "created_at"               TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "billing_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_periods_institutional_order_id_month_key"
  ON "billing_periods"("institutional_order_id", "month");
CREATE INDEX "billing_periods_month_idx"  ON "billing_periods"("month");
CREATE INDEX "billing_periods_status_idx" ON "billing_periods"("status");

ALTER TABLE "billing_periods"
  ADD CONSTRAINT "billing_periods_institutional_order_id_fkey"
  FOREIGN KEY ("institutional_order_id") REFERENCES "institutional_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Editable line items per billing period (one per cycle by default; admin can add manual lines)
CREATE TABLE "billing_period_lines" (
  "id"                  TEXT          NOT NULL,
  "billing_period_id"   TEXT          NOT NULL,
  "cycle_id"            TEXT,
  "description"         TEXT          NOT NULL,
  "quantity"            DECIMAL(10,2) NOT NULL,
  "unit_price"          DECIMAL(10,2) NOT NULL,
  "total"               DECIMAL(10,2) NOT NULL,
  "sort_order"          INTEGER       NOT NULL DEFAULT 0,
  "created_at"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "billing_period_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_period_lines_billing_period_id_idx"
  ON "billing_period_lines"("billing_period_id");

ALTER TABLE "billing_period_lines"
  ADD CONSTRAINT "billing_period_lines_billing_period_id_fkey"
  FOREIGN KEY ("billing_period_id") REFERENCES "billing_periods"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_period_lines"
  ADD CONSTRAINT "billing_period_lines_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
