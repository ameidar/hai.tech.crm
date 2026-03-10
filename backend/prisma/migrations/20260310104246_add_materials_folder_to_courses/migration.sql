-- AddColumn: materials_folder_id to courses
ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "materials_folder_id" TEXT;
