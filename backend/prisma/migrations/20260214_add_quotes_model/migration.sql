-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted');

-- AlterTable: Add new fields to institutional_orders
ALTER TABLE "institutional_orders" ADD COLUMN "invoice_link" TEXT;
ALTER TABLE "institutional_orders" ADD COLUMN "invoice_number" TEXT;
ALTER TABLE "institutional_orders" ADD COLUMN "paid_amount" DECIMAL(10,2) DEFAULT 0;
ALTER TABLE "institutional_orders" ADD COLUMN "payment_status" "PaymentStatus";
ALTER TABLE "institutional_orders" ADD COLUMN "total_amount" DECIMAL(10,2);

-- CreateTable: quotes
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "quote_number" TEXT NOT NULL,
    "branch_id" TEXT,
    "institution_name" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "contact_email" TEXT,
    "contact_role" TEXT,
    "content" JSONB,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2) DEFAULT 0,
    "final_amount" DECIMAL(10,2) NOT NULL,
    "valid_until" DATE,
    "status" "QuoteStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "order_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: quote_items
CREATE TABLE "quote_items" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "course_id" TEXT,
    "course_name" TEXT NOT NULL,
    "description" TEXT,
    "groups" INTEGER NOT NULL,
    "meetings_per_group" INTEGER NOT NULL,
    "price_per_meeting" DECIMAL(10,2) NOT NULL,
    "meeting_duration" INTEGER NOT NULL DEFAULT 90,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_quote_number_key" ON "quotes"("quote_number");
CREATE UNIQUE INDEX "quotes_order_id_key" ON "quotes"("order_id");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "institutional_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
