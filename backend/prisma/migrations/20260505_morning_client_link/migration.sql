-- Add morning_client_id to institutional_orders.
-- Lets us cache the Morning (GreenInvoice) customer UUID once we discover it,
-- so subsequent invoices for the same institution don't have to search Morning
-- again — and don't risk creating a duplicate customer record there.

ALTER TABLE "institutional_orders"
  ADD COLUMN "morning_client_id" TEXT;
