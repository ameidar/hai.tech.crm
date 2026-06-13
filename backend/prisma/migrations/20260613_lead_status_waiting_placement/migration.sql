-- Add "waiting_placement" lead status — set automatically when a non-digital
-- payment arrives and the child has no active cycle yet (needs to be scheduled).
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'waiting_placement';
