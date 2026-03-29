-- AlterTable: make customer phone nullable
ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL;
