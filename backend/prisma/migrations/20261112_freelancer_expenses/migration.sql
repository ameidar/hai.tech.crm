-- Freelancer pay separation + invoice-vs-activity reconciliation.
-- Additive only.
CREATE TABLE "instructor_expense_suppliers" (
    "id" TEXT NOT NULL,
    "instructor_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "supplier_name" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "instructor_expense_suppliers_pkey" PRIMARY KEY ("id")
);
-- One Morning supplier maps to at most one instructor (NULL supplier ids never collide).
CREATE UNIQUE INDEX "instructor_expense_suppliers_supplier_id_key" ON "instructor_expense_suppliers"("supplier_id");
CREATE UNIQUE INDEX "instructor_expense_suppliers_supplier_name_lower_key" ON "instructor_expense_suppliers"(LOWER("supplier_name"));
CREATE INDEX "instructor_expense_suppliers_instructor_id_idx" ON "instructor_expense_suppliers"("instructor_id");
ALTER TABLE "instructor_expense_suppliers" ADD CONSTRAINT "instructor_expense_suppliers_instructor_id_fkey"
    FOREIGN KEY ("instructor_id") REFERENCES "instructors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CRM-only activity-month override ("YYYY-MM"); the Morning sync never writes it.
ALTER TABLE "company_expenses" ADD COLUMN "activity_month" TEXT;
