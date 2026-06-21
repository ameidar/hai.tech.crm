-- Completed cycles are operationally closed even when their original plan had
-- more lessons. Keep the historical total/completed counts, but prevent stale
-- remaining_meetings values from feeding reminders, dashboards, or forecasts.
UPDATE "cycles"
SET "remaining_meetings" = 0
WHERE "status" = 'completed'
  AND "remaining_meetings" <> 0;
