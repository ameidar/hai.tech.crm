-- CreateTable: ai_lesson_logs
CREATE TABLE "ai_lesson_logs" (
    "id"          TEXT NOT NULL,
    "user_id"     TEXT NOT NULL,
    "user_name"   TEXT,
    "course_id"   TEXT,
    "course_name" TEXT,
    "cycle_name"  TEXT,
    "age_group"   TEXT,
    "topic"       TEXT,
    "used_drive"  BOOLEAN NOT NULL DEFAULT false,
    "drive_files" TEXT,
    "response"    TEXT NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_lesson_logs_pkey" PRIMARY KEY ("id")
);
