ALTER TABLE "cycles"
  ADD COLUMN IF NOT EXISTS "minimum_students_threshold" INTEGER;

CREATE TABLE IF NOT EXISTS "operations_control_issue_states" (
  "issue_key" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'new',
  "note" TEXT,
  "title" TEXT,
  "type" TEXT,
  "priority" TEXT,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "last_alert_snapshot" JSONB,
  "closed_at" TIMESTAMP(3),
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operations_control_issue_states_status_check"
    CHECK ("status" IN ('new', 'in_progress', 'waiting', 'closed')),
  CONSTRAINT "operations_control_issue_states_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "operations_control_issue_states_status_idx"
  ON "operations_control_issue_states"("status");

CREATE INDEX IF NOT EXISTS "operations_control_issue_states_type_idx"
  ON "operations_control_issue_states"("type");

CREATE INDEX IF NOT EXISTS "operations_control_issue_states_entity_type_entity_id_idx"
  ON "operations_control_issue_states"("entity_type", "entity_id");
