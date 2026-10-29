-- Monthly fixed billing for institutional orders (תשלום חודשי קבוע).
-- Additive only: existing orders default to 'per_meeting' and keep their current behavior.
-- monthly_amounts maps "YYYY-MM" -> amount as entered; monthly_amounts_include_vat says
-- whether those amounts include 18% VAT (meeting revenue is always stored pre-VAT).

ALTER TABLE "institutional_orders"
  ADD COLUMN IF NOT EXISTS "billing_mode" TEXT NOT NULL DEFAULT 'per_meeting',
  ADD COLUMN IF NOT EXISTS "monthly_amounts" JSONB,
  ADD COLUMN IF NOT EXISTS "monthly_amounts_include_vat" BOOLEAN NOT NULL DEFAULT true;
