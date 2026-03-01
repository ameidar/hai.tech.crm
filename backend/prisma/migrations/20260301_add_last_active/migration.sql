-- AddColumn: last_active to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active" TIMESTAMP(3);
