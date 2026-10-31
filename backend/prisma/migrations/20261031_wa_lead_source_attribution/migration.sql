-- WhatsApp lead-source attribution.
-- hai.tech appends a 6-char ref code ("🔹CODE") to the prefilled WhatsApp text and beacons the
-- click's attribution data to POST /api/public/wa-click. The first inbound WA message carrying
-- the code is matched to the click and the source is copied onto the conversation.

ALTER TABLE "wa_conversations"
  ADD COLUMN IF NOT EXISTS "lead_source_channel" TEXT;

-- Backfill: conversations that already carry a Meta referral came from a Click-to-WhatsApp ad.
UPDATE "wa_conversations"
SET "lead_source_channel" = 'meta_ctwa'
WHERE "lead_source_channel" IS NULL
  AND "referral_source_type" IS NOT NULL
  AND "referral_source_type" <> ''
  AND "referral_source_type" <> 'website';

CREATE TABLE IF NOT EXISTS "wa_click_refs" (
  "id"                      TEXT NOT NULL,
  "code"                    TEXT NOT NULL,
  "page_url"                TEXT,
  "page_path"               TEXT,
  "page_title"              TEXT,
  "wa_number"               TEXT,
  "prefill"                 TEXT,
  "utm_source"              TEXT,
  "utm_medium"              TEXT,
  "utm_campaign"            TEXT,
  "utm_content"             TEXT,
  "utm_term"                TEXT,
  "gclid"                   TEXT,
  "gbraid"                  TEXT,
  "wbraid"                  TEXT,
  "fbclid"                  TEXT,
  "referrer"                TEXT,
  "landing_path"            TEXT,
  "first_touch"             JSONB,
  "clicked_at"              TIMESTAMP(3),
  "ip_hash"                 TEXT,
  "user_agent"              TEXT,
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "matched_conversation_id" TEXT,
  "matched_at"              TIMESTAMP(3),
  CONSTRAINT "wa_click_refs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_click_refs_code_key" ON "wa_click_refs"("code");
CREATE INDEX IF NOT EXISTS "wa_click_refs_created_at_idx" ON "wa_click_refs"("created_at");
CREATE INDEX IF NOT EXISTS "wa_click_refs_matched_conversation_id_idx" ON "wa_click_refs"("matched_conversation_id");

ALTER TABLE "wa_click_refs"
  ADD CONSTRAINT "wa_click_refs_matched_conversation_id_fkey"
  FOREIGN KEY ("matched_conversation_id") REFERENCES "wa_conversations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
