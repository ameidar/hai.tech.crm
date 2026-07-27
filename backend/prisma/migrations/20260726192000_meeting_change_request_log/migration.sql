-- Add durable review notes and query indexes for instructor cancellation/postponement monitoring.
ALTER TABLE "meeting_change_requests"
  ADD COLUMN "review_notes" TEXT;

CREATE INDEX "meeting_change_requests_instructor_id_created_at_idx"
  ON "meeting_change_requests"("instructor_id", "created_at");

CREATE INDEX "meeting_change_requests_type_status_created_at_idx"
  ON "meeting_change_requests"("type", "status", "created_at");

CREATE INDEX "meeting_change_requests_meeting_id_idx"
  ON "meeting_change_requests"("meeting_id");
