ALTER TABLE "tasks" ADD COLUMN "completion_summary" TEXT;
ALTER TABLE "tasks" ADD COLUMN "completion_details" TEXT;
ALTER TABLE "tasks" ADD COLUMN "completion_link" TEXT;
ALTER TABLE "tasks" ADD COLUMN "requires_completion_link" BOOLEAN NOT NULL DEFAULT false;
