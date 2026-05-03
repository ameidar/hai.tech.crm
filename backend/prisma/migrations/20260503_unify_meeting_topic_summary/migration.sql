-- Unify meeting.topic and meeting.lesson_summary into a single field (`topic`).
-- Background:
--   `topic` was a manual pre-lesson plan input by managers/instructors.
--   `lesson_summary` was an AI-generated post-lesson recap from Zoom recordings,
--   read separately by the WhatsApp pre-meeting reminder service.
--   In practice instructors used `topic` as a recap field (the only one shown in the UI),
--   so the reminder service kept finding `lesson_summary` empty and never included a recap.
--
-- Strategy:
--   1. Backfill `topic` from `lesson_summary` only where `topic` is NULL/empty
--      and `lesson_summary` has content. This preserves any manual `topic` text.
--   2. Where BOTH have content, append `lesson_summary` to `topic` so no info is lost.
--   3. Drop the `lesson_summary` column.

-- Step 1+2: backfill / merge
UPDATE "meetings"
SET "topic" = CASE
  WHEN COALESCE(NULLIF(TRIM("topic"), ''), NULL) IS NULL
    THEN "lesson_summary"
  WHEN "lesson_summary" IS NOT NULL AND TRIM("lesson_summary") != '' AND "topic" != "lesson_summary"
    THEN "topic" || E'\n\n📝 ' || "lesson_summary"
  ELSE "topic"
END
WHERE "lesson_summary" IS NOT NULL AND TRIM("lesson_summary") != '';

-- Step 3: drop the deprecated column
ALTER TABLE "meetings" DROP COLUMN "lesson_summary";
