-- Add bank details fields to instructors table
ALTER TABLE "instructors" ADD COLUMN "bank_name" VARCHAR(255);
ALTER TABLE "instructors" ADD COLUMN "bank_branch" VARCHAR(255);
ALTER TABLE "instructors" ADD COLUMN "account_number" VARCHAR(255);
