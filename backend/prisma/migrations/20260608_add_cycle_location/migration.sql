-- Add per-cycle location/city (required for frontal cycles, optional for online/private).
-- Surfaced as the location in the instructor salary report.
ALTER TABLE "cycles" ADD COLUMN "location" TEXT;
