CREATE TYPE "VideoMeetingProvider" AS ENUM ('zoom', 'google_meet');

ALTER TABLE "cycles"
  ADD COLUMN "video_provider" "VideoMeetingProvider" NOT NULL DEFAULT 'zoom',
  ADD COLUMN "google_meet_space_name" TEXT,
  ADD COLUMN "google_calendar_event_id" TEXT;

ALTER TABLE "meetings"
  ADD COLUMN "video_provider" "VideoMeetingProvider" NOT NULL DEFAULT 'zoom',
  ADD COLUMN "google_meet_space_name" TEXT,
  ADD COLUMN "google_calendar_event_id" TEXT;

ALTER TABLE "internal_zoom_meetings"
  ADD COLUMN "video_provider" "VideoMeetingProvider" NOT NULL DEFAULT 'zoom',
  ADD COLUMN "google_meet_space_name" TEXT,
  ADD COLUMN "google_calendar_event_id" TEXT;
