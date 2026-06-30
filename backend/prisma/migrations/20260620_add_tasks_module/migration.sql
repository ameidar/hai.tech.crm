CREATE TYPE "TaskStatus" AS ENUM ('new', 'in_progress', 'waiting_info', 'completed');

CREATE TYPE "TaskPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

CREATE TYPE "ReminderChannel" AS ENUM ('whatsapp', 'email');

CREATE TYPE "ReminderStatus" AS ENUM ('pending', 'sent', 'failed');

CREATE TABLE "tasks" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "TaskStatus" NOT NULL DEFAULT 'new',
  "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
  "due_date" TIMESTAMP(3),
  "created_by_id" TEXT NOT NULL,
  "assignee_id" TEXT,
  "completed_at" TIMESTAMP(3),
  "completed_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tasks_status_idx" ON "tasks"("status");
CREATE INDEX "tasks_priority_idx" ON "tasks"("priority");
CREATE INDEX "tasks_assignee_id_idx" ON "tasks"("assignee_id");
CREATE INDEX "tasks_created_by_id_idx" ON "tasks"("created_by_id");
CREATE INDEX "tasks_due_date_idx" ON "tasks"("due_date");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_assignee_id_fkey"
  FOREIGN KEY ("assignee_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_completed_by_id_fkey"
  FOREIGN KEY ("completed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "task_reminders" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "channel" "ReminderChannel" NOT NULL,
  "remind_at" TIMESTAMP(3) NOT NULL,
  "sent_at" TIMESTAMP(3),
  "status" "ReminderStatus" NOT NULL DEFAULT 'pending',
  "failure_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "task_reminders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_reminders_status_remind_at_idx" ON "task_reminders"("status", "remind_at");
CREATE INDEX "task_reminders_task_id_idx" ON "task_reminders"("task_id");

ALTER TABLE "task_reminders"
  ADD CONSTRAINT "task_reminders_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
