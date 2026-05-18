-- Cache Morning (GreenInvoice) client UUID on personal customers, same pattern
-- as institutional_orders. Lets us reuse the same Morning client on every
-- payment-link / invoice and avoid duplicates.
ALTER TABLE "customers"
  ADD COLUMN "morning_client_id" TEXT;

-- Persistent record of every payment link we generate. Also backs the short
-- URL: /pl/<code> looks up `code` and redirects to `morning_url`.
CREATE TABLE "payment_links" (
  "id"            TEXT NOT NULL,
  "code"          TEXT NOT NULL,
  "description"   TEXT NOT NULL,
  "amount"        DECIMAL(10,2) NOT NULL,
  "max_payments"  INTEGER NOT NULL DEFAULT 1,
  "document_type" INTEGER NOT NULL DEFAULT 400,
  "vat_type"      INTEGER NOT NULL DEFAULT 0,
  "morning_url"   TEXT NOT NULL,
  "customer_id"   TEXT,
  "client_name"   TEXT NOT NULL,
  "client_email"  TEXT,
  "client_phone"  TEXT,
  "client_tax_id" TEXT,
  "created_by"    TEXT,
  "clicks"        INTEGER NOT NULL DEFAULT 0,
  "last_clicked_at" TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_links_code_key" ON "payment_links"("code");
CREATE INDEX "payment_links_customer_id_idx" ON "payment_links"("customer_id");
CREATE INDEX "payment_links_created_at_idx" ON "payment_links"("created_at" DESC);

ALTER TABLE "payment_links"
  ADD CONSTRAINT "payment_links_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
