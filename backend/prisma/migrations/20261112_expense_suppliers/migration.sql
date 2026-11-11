-- Expense suppliers registry (extends recurring_expenses) + manual invoice uploads to Morning.
-- Additive only.
ALTER TABLE "recurring_expenses" ADD COLUMN "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "recurring_expenses" ADD COLUMN "invoice_source" TEXT NOT NULL DEFAULT 'portal';
ALTER TABLE "recurring_expenses" ADD COLUMN "portal_url" TEXT;
ALTER TABLE "recurring_expenses" ADD COLUMN "instructions" TEXT;
ALTER TABLE "recurring_expenses" ADD COLUMN "owner" TEXT;
ALTER TABLE "recurring_expenses" ADD COLUMN "expected_month" INTEGER;
ALTER TABLE "recurring_expenses" ADD COLUMN "email_mailbox" TEXT;
ALTER TABLE "recurring_expenses" ADD COLUMN "email_from" TEXT;
ALTER TABLE "recurring_expenses" ADD COLUMN "email_subject" TEXT;

CREATE TABLE "expense_uploads" (
    "id" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "uploaded_by" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL,
    "error" TEXT,
    "recurring_expense_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expense_uploads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "expense_uploads_file_sha256_key" ON "expense_uploads"("file_sha256");
CREATE INDEX "expense_uploads_recurring_expense_id_idx" ON "expense_uploads"("recurring_expense_id");
CREATE INDEX "expense_uploads_created_at_idx" ON "expense_uploads"("created_at");
ALTER TABLE "expense_uploads" ADD CONSTRAINT "expense_uploads_recurring_expense_id_fkey"
    FOREIGN KEY ("recurring_expense_id") REFERENCES "recurring_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
