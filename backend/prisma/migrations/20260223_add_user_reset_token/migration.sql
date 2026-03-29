-- AlterTable
ALTER TABLE "users" ADD COLUMN "reset_token" TEXT UNIQUE;
ALTER TABLE "users" ADD COLUMN "reset_token_expiry" TIMESTAMP(3);
