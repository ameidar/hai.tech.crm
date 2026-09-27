ALTER TABLE "wa_conversations"
  ADD COLUMN IF NOT EXISTS "referral_source_id" TEXT,
  ADD COLUMN IF NOT EXISTS "referral_source_type" TEXT,
  ADD COLUMN IF NOT EXISTS "referral_headline" TEXT,
  ADD COLUMN IF NOT EXISTS "referral_body" TEXT,
  ADD COLUMN IF NOT EXISTS "referral_source_url" TEXT,
  ADD COLUMN IF NOT EXISTS "referral_click_id" TEXT;
