CREATE TYPE "InternalZoomMeetingStatus" AS ENUM ('scheduled', 'cancelled');

CREATE TABLE "internal_zoom_meetings" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "title" TEXT NOT NULL,
  "requester_name" TEXT NOT NULL,
  "requested_by_id" TEXT,
  "start_at" TIMESTAMP(3) NOT NULL,
  "end_at" TIMESTAMP(3) NOT NULL,
  "duration_minutes" INTEGER NOT NULL,
  "zoom_host_id" TEXT,
  "zoom_host_email" TEXT,
  "zoom_meeting_id" TEXT,
  "zoom_join_url" TEXT,
  "zoom_start_url" TEXT,
  "zoom_password" TEXT,
  "zoom_host_key" TEXT,
  "status" "InternalZoomMeetingStatus" NOT NULL DEFAULT 'scheduled',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelled_at" TIMESTAMP(3),
  "cancelled_by_id" TEXT,

  CONSTRAINT "internal_zoom_meetings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "internal_zoom_meetings_start_at_idx" ON "internal_zoom_meetings"("start_at");
CREATE INDEX "internal_zoom_meetings_status_idx" ON "internal_zoom_meetings"("status");
CREATE INDEX "internal_zoom_meetings_zoom_host_email_idx" ON "internal_zoom_meetings"("zoom_host_email");
