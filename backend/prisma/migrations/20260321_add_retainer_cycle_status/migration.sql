-- Add retainer to CycleStatus enum
ALTER TYPE "CycleStatus" ADD VALUE IF NOT EXISTS 'retainer';
