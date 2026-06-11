-- New first-class "paying body" (גוף משלם) entity — mirrors a client in Morning.
-- Many institutional orders can point to the same paying body, so the customer name /
-- taxId have one source of truth and we stop creating duplicate clients in Morning.
--
-- DDL only. The old free-text fields on institutional_orders (paying_body, tax_id,
-- contact_*, address/city/zip) are intentionally KEPT for a transition period.
-- Required fields are enforced in the app layer; legacy rows are backfilled as
-- is_complete=false by scripts/backfill-paying-bodies.ts (run post-deploy).

CREATE TABLE "paying_bodies" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tax_id" TEXT,
  "contact_name" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "city" TEXT,
  "zip" TEXT,
  "morning_client_id" TEXT,
  "is_complete" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "paying_bodies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "institutional_orders" ADD COLUMN "paying_body_id" TEXT;

ALTER TABLE "institutional_orders"
  ADD CONSTRAINT "institutional_orders_paying_body_id_fkey"
  FOREIGN KEY ("paying_body_id") REFERENCES "paying_bodies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "institutional_orders_paying_body_id_idx" ON "institutional_orders"("paying_body_id");
