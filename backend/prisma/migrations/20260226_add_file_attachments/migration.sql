-- CreateTable: file_attachments
CREATE TABLE IF NOT EXISTS "file_attachments" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "label" TEXT,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_file_attachments_entity" ON "file_attachments"("entity_type", "entity_id");

-- AddForeignKey (optional, soft reference)
ALTER TABLE "file_attachments" DROP CONSTRAINT IF EXISTS "file_attachments_uploaded_by_fkey";
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_uploaded_by_fkey" 
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
