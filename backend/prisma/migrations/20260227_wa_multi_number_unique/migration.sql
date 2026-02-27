-- Migration: Change wa_conversations unique constraint from phone to (phone, phone_number_id)
-- This allows the same phone number to have separate conversations per bot number

-- Drop old unique constraint on phone
ALTER TABLE wa_conversations DROP CONSTRAINT IF EXISTS wa_conversations_phone_key;

-- Add new composite unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS wa_conversations_phone_phone_number_id_key 
  ON wa_conversations(phone, phone_number_id);
