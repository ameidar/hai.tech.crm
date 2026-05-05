-- Add morning_draft_id to billing_periods to support the "draft → manual issue" flow.
-- When the user pushes a billing period to Morning as a draft (rather than a finalized
-- document), we store the Morning draft UUID here. They finalize the document inside
-- Morning's UI (which lets them backdate beyond the strict API window) and then call
-- our mark-issued-manually route to fill in the morningDoc* fields.

ALTER TABLE "billing_periods"
  ADD COLUMN "morning_draft_id" TEXT;
