ALTER TABLE "meetings"
  ADD COLUMN IF NOT EXISTS "recall_bot_id" TEXT,
  ADD COLUMN IF NOT EXISTS "recall_bot_status" TEXT,
  ADD COLUMN IF NOT EXISTS "recall_recording_id" TEXT,
  ADD COLUMN IF NOT EXISTS "recall_recording_url" TEXT,
  ADD COLUMN IF NOT EXISTS "recall_transcript_url" TEXT,
  ADD COLUMN IF NOT EXISTS "lesson_summary" TEXT,
  ADD COLUMN IF NOT EXISTS "lesson_report_status" TEXT,
  ADD COLUMN IF NOT EXISTS "lesson_report_generated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lesson_report_error" TEXT;

CREATE INDEX IF NOT EXISTS "meetings_recall_bot_id_idx"
  ON "meetings"("recall_bot_id");

CREATE INDEX IF NOT EXISTS "meetings_lesson_report_status_idx"
  ON "meetings"("lesson_report_status");
