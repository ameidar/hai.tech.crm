-- AlterTable: make existing required fields optional
ALTER TABLE "institutional_orders"
  ALTER COLUMN "start_date" DROP NOT NULL,
  ALTER COLUMN "end_date" DROP NOT NULL,
  ALTER COLUMN "price_per_meeting" DROP NOT NULL,
  ALTER COLUMN "contact_name" DROP NOT NULL,
  ALTER COLUMN "contact_phone" DROP NOT NULL;

-- AlterTable: make branch_id optional (change FK to SET NULL)
ALTER TABLE "institutional_orders"
  ALTER COLUMN "branch_id" DROP NOT NULL;

ALTER TABLE "institutional_orders"
  DROP CONSTRAINT IF EXISTS "institutional_orders_branch_id_fkey";

ALTER TABLE "institutional_orders"
  ADD CONSTRAINT "institutional_orders_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddColumn: new Fireberry fields
ALTER TABLE "institutional_orders"
  ADD COLUMN IF NOT EXISTS "order_name"       TEXT,
  ADD COLUMN IF NOT EXISTS "fireberry_status" TEXT,
  ADD COLUMN IF NOT EXISTS "paying_body"      TEXT,
  ADD COLUMN IF NOT EXISTS "follow_up_date"   DATE,
  ADD COLUMN IF NOT EXISTS "salesperson"      TEXT,
  ADD COLUMN IF NOT EXISTS "order_type"       TEXT,
  ADD COLUMN IF NOT EXISTS "created_by"       TEXT;
