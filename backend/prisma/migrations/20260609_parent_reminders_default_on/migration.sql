-- Parent reminders are now opt-out per cycle (default on).
-- The reminder cron previously ignored send_parent_reminders entirely, so every
-- cycle effectively received reminders. Backfill all existing rows to true to
-- preserve that behavior, then flip the column default so new cycles opt in by default.
UPDATE "cycles" SET "send_parent_reminders" = true;
ALTER TABLE "cycles" ALTER COLUMN "send_parent_reminders" SET DEFAULT true;
