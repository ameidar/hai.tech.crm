CREATE TABLE "lesson_quizzes" (
  "id" TEXT NOT NULL,
  "meeting_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "questions" JSONB NOT NULL,
  "answers" JSONB,
  "score" INTEGER,
  "total_questions" INTEGER NOT NULL,
  "submitted_at" TIMESTAMP(3),
  "instructor_email_snapshot" TEXT,
  "student_name_snapshot" TEXT,
  "email_sent_at" TIMESTAMP(3),
  "email_error" TEXT,
  "generation_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "lesson_quizzes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lesson_quizzes_meeting_id_key" ON "lesson_quizzes"("meeting_id");
CREATE UNIQUE INDEX "lesson_quizzes_token_key" ON "lesson_quizzes"("token");
CREATE INDEX "lesson_quizzes_status_idx" ON "lesson_quizzes"("status");
CREATE INDEX "lesson_quizzes_submitted_at_idx" ON "lesson_quizzes"("submitted_at");

ALTER TABLE "lesson_quizzes" ADD CONSTRAINT "lesson_quizzes_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
