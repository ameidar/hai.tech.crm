-- Extend billing_periods to span an inclusive range of whole months instead of a single month,
-- and let admins mark a line's description as customized so re-generation does not clobber it.

-- 1. btree_gist is needed for the no-overlap EXCLUDE constraint (mixes equality on text with range overlap).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Rename month → month_start and backfill month_end with the same value (single-month range).
ALTER TABLE "billing_periods" RENAME COLUMN "month" TO "month_start";
ALTER TABLE "billing_periods" ADD COLUMN "month_end" DATE;
UPDATE "billing_periods" SET "month_end" = "month_start" WHERE "month_end" IS NULL;
ALTER TABLE "billing_periods" ALTER COLUMN "month_end" SET NOT NULL;

-- 3. Replace the old unique on (institutional_order_id, month).
ALTER TABLE "billing_periods"
  DROP CONSTRAINT IF EXISTS "billing_periods_institutional_order_id_month_key";
DROP INDEX IF EXISTS "billing_periods_institutional_order_id_month_key";
DROP INDEX IF EXISTS "billing_periods_month_idx";

CREATE UNIQUE INDEX "billing_periods_institutional_order_id_month_start_month_end_key"
  ON "billing_periods" ("institutional_order_id", "month_start", "month_end");
CREATE INDEX "billing_periods_month_start_idx" ON "billing_periods" ("month_start");
CREATE INDEX "billing_periods_month_end_idx"   ON "billing_periods" ("month_end");

-- 4. Sanity check: monthEnd must not precede monthStart.
ALTER TABLE "billing_periods"
  ADD CONSTRAINT "billing_periods_month_range_chk"
  CHECK ("month_end" >= "month_start");

-- 5. Hard block on overlapping non-cancelled ranges for the same institutional order.
--    Convert the inclusive [month_start, month_end] pair into a half-open daterange
--    covering complete months, then exclude any && overlap per institution.
ALTER TABLE "billing_periods"
  ADD CONSTRAINT "billing_periods_no_overlap"
  EXCLUDE USING gist (
    "institutional_order_id" WITH =,
    daterange(
      "month_start",
      ("month_end" + INTERVAL '1 month')::date,
      '[)'
    ) WITH &&
  )
  WHERE ("status" <> 'cancelled');

-- 6. Per-line flag — when true, generate / regenerate preserves the description.
ALTER TABLE "billing_period_lines"
  ADD COLUMN "description_customized" BOOLEAN NOT NULL DEFAULT false;
