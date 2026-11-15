-- Tentative cycles: a cycle whose activity is not yet confirmed. Its meetings get the
-- 'tentative' meeting status so they spread forecast revenue (as tentativeRevenue) across
-- months WITHOUT any side effects (reminders, WhatsApp/email, video/calendar, payroll, billing).
-- Additive only. ALTER TYPE ... ADD VALUE must not be used in the same transaction that adds
-- it, so this migration contains nothing else.
ALTER TYPE "CycleStatus" ADD VALUE IF NOT EXISTS 'tentative';
ALTER TYPE "MeetingStatus" ADD VALUE IF NOT EXISTS 'tentative';
