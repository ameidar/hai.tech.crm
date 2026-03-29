-- Messenger conversations table
CREATE TABLE IF NOT EXISTS messenger_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  psid VARCHAR(100) NOT NULL UNIQUE,  -- Facebook Page-Scoped User ID
  sender_name VARCHAR(255),
  page_id VARCHAR(100),
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  ai_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messenger messages table
CREATE TABLE IF NOT EXISTS messenger_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content TEXT NOT NULL,
  msg_id VARCHAR(255) UNIQUE,
  is_ai_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messenger_msgs_conv ON messenger_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messenger_convs_last ON messenger_conversations(last_message_at DESC NULLS LAST);
