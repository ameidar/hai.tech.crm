-- CreateEnum
CREATE TYPE "UpsellLeadStatus" AS ENUM ('new', 'contacted', 'converted', 'dismissed');

-- CreateTable
CREATE TABLE "upsell_leads" (
    "id" SERIAL NOT NULL,
    "registration_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "completed_course" TEXT NOT NULL,
    "status" "UpsellLeadStatus" NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upsell_leads_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "upsell_leads" ADD CONSTRAINT "upsell_leads_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upsell_leads" ADD CONSTRAINT "upsell_leads_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upsell_leads" ADD CONSTRAINT "upsell_leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
