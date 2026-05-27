-- Add `nature` field to meetings to distinguish revenue-generating from internal/operational
-- meetings (team calls, technical ops, instructor coaching). `no_revenue` meetings are
-- excluded from revenue rollups but still carry instructor_payment as an expense.

CREATE TYPE "MeetingNature" AS ENUM ('regular', 'no_revenue');

ALTER TABLE "meetings"
  ADD COLUMN "nature" "MeetingNature" NOT NULL DEFAULT 'regular';
