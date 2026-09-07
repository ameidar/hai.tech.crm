ALTER TABLE "lesson_quizzes"
  ADD COLUMN "parent_sent_at" TIMESTAMP(3),
  ADD COLUMN "parent_sent_to_phone" TEXT,
  ADD COLUMN "parent_message_id" TEXT,
  ADD COLUMN "parent_send_error" TEXT;
