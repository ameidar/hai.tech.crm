-- All institutional prices are quoted before VAT (net) by policy, so a cycle's
-- revenue_includes_vat now defaults to false. Only flip the column default — no
-- backfill of existing NULL rows here; that is a separate decision.
ALTER TABLE "cycles" ALTER COLUMN "revenue_includes_vat" SET DEFAULT false;
