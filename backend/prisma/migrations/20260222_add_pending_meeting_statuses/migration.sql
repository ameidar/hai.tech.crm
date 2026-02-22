-- Add pending_cancellation and pending_postponement to MeetingStatus enum
-- Instructors can now request cancellation/postponement which requires admin approval

ALTER TYPE "MeetingStatus" ADD VALUE IF NOT EXISTS 'pending_cancellation';
ALTER TYPE "MeetingStatus" ADD VALUE IF NOT EXISTS 'pending_postponement';
