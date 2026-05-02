-- Payment tracking + meeting snapshot for monthly billing periods.

CREATE TYPE "BillingPaymentStatus" AS ENUM ('unpaid', 'partial', 'paid');

ALTER TABLE "billing_periods"
  ADD COLUMN "due_date"               DATE,
  ADD COLUMN "tax_invoice_id"         TEXT,
  ADD COLUMN "tax_invoice_number"     INTEGER,
  ADD COLUMN "tax_invoice_url"        TEXT,
  ADD COLUMN "tax_invoice_issued_at"  TIMESTAMP(3),
  ADD COLUMN "tax_invoice_issued_by_id" TEXT,
  ADD COLUMN "sent_at"                TIMESTAMP(3),
  ADD COLUMN "sent_channel"           TEXT,
  ADD COLUMN "sent_to_email"          TEXT,
  ADD COLUMN "sent_to_phone"          TEXT,
  ADD COLUMN "payment_status"         "BillingPaymentStatus" NOT NULL DEFAULT 'unpaid',
  ADD COLUMN "paid_amount"            DECIMAL(10, 2)         NOT NULL DEFAULT 0,
  ADD COLUMN "paid_at"                TIMESTAMP(3);

CREATE INDEX "billing_periods_payment_status_idx" ON "billing_periods"("payment_status");

CREATE TABLE "billing_period_meetings" (
  "id"                  TEXT                NOT NULL,
  "billing_period_id"   TEXT                NOT NULL,
  "line_id"             TEXT,
  "meeting_id"          TEXT                NOT NULL,
  "created_at"          TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_period_meetings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_period_meetings_billing_period_id_meeting_id_key"
  ON "billing_period_meetings"("billing_period_id", "meeting_id");
CREATE INDEX "billing_period_meetings_meeting_id_idx"
  ON "billing_period_meetings"("meeting_id");

ALTER TABLE "billing_period_meetings"
  ADD CONSTRAINT "billing_period_meetings_billing_period_id_fkey"
    FOREIGN KEY ("billing_period_id") REFERENCES "billing_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_period_meetings_line_id_fkey"
    FOREIGN KEY ("line_id") REFERENCES "billing_period_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "billing_period_meetings_meeting_id_fkey"
    FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "billing_payments" (
  "id"                  TEXT          NOT NULL,
  "billing_period_id"   TEXT          NOT NULL,
  "amount"              DECIMAL(10,2) NOT NULL,
  "method"              TEXT,
  "notes"               TEXT,
  "paid_at"             TIMESTAMP(3)  NOT NULL,
  "recorded_by_id"      TEXT,
  "created_at"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_payments_billing_period_id_idx"
  ON "billing_payments"("billing_period_id");

ALTER TABLE "billing_payments"
  ADD CONSTRAINT "billing_payments_billing_period_id_fkey"
    FOREIGN KEY ("billing_period_id") REFERENCES "billing_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
