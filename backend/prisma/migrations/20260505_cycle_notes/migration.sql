-- Add free-form admin notes to cycles. Used to record pricing assumptions like
-- "monthly contract priced as if 4 meetings/month" so we don't lose the why
-- behind a fractional pricePerStudent value.

ALTER TABLE "cycles"
  ADD COLUMN "notes" TEXT;
