-- Add activity_type enum and fields
-- Migration: add_activity_type
-- Date: 2026-02-01

-- Create the enum type
CREATE TYPE activity_type AS ENUM ('online', 'frontal', 'private');

-- Add activity_type to cycles with default 'frontal'
ALTER TABLE cycles ADD COLUMN activity_type activity_type NOT NULL DEFAULT 'frontal';

-- Migrate existing data: set activity_type based on is_online
UPDATE cycles SET activity_type = 'online' WHERE is_online = true;
UPDATE cycles SET activity_type = 'frontal' WHERE is_online = false;

-- For private cycles, set activity_type to 'private'
UPDATE cycles SET activity_type = 'private' WHERE type = 'private';

-- Add activity_type to meetings (nullable - inherits from cycle if not set)
ALTER TABLE meetings ADD COLUMN activity_type activity_type;

-- Create index for activity_type queries
CREATE INDEX idx_cycles_activity_type ON cycles(activity_type);
CREATE INDEX idx_meetings_activity_type ON meetings(activity_type);
