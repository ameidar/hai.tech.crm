-- Add "refunded" (זוכה) to PaymentStatus: a registration/cycle that was paid and then
-- cancelled with a Morning credit note. Treated as NOT paid everywhere (revenue, evidence).
-- Additive only; ADD VALUE cannot run inside a transaction block on PG < 12 — it is the
-- only statement here, so Prisma's migrate deploy handles it.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'refunded';
