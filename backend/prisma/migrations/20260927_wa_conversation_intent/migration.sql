ALTER TABLE "wa_conversations"
  ADD COLUMN IF NOT EXISTS "intent" TEXT,
  ADD COLUMN IF NOT EXISTS "intent_confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "intent_needs_human" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "intent_classified_at" TIMESTAMP(3);
