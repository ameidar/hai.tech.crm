-- Instagram conversations table
CREATE TABLE IF NOT EXISTS instagram_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  igsid VARCHAR(100) NOT NULL UNIQUE,   -- Instagram-Scoped User ID
  sender_name VARCHAR(255),
  sender_username VARCHAR(255),
  ig_user_id VARCHAR(100),              -- Our IG account ID
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  ai_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Instagram messages table
CREATE TABLE IF NOT EXISTS instagram_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES instagram_conversations(id) ON DELETE CASCADE,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content TEXT NOT NULL,
  msg_id VARCHAR(255) UNIQUE,
  is_ai_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_msgs_conv ON instagram_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ig_convs_last ON instagram_conversations(last_message_at DESC NULLS LAST);
