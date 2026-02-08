-- Migration: Add Messaging System
-- Date: 2026-02-08
-- Description: Message templates and logs for instructor communications

-- 1. Message Templates table
CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email', 'both')),
  subject TEXT, -- for email
  body TEXT NOT NULL,
  placeholders TEXT[], -- list of available placeholders
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
);

-- 2. Message Logs table
CREATE TABLE IF NOT EXISTS message_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  instructor_id TEXT NOT NULL,
  template_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  recipient TEXT NOT NULL, -- phone or email
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'pending')),
  error_message TEXT,
  sent_by TEXT, -- user id who sent
  meeting_id TEXT, -- related meeting if applicable
  created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
);

-- 3. Insert default templates
INSERT INTO message_templates (id, name, channel, subject, body, placeholders) VALUES
(
  'tpl-status-reminder',
  'תזכורת מילוי סטטוס',
  'both',
  'תזכורת - עדכון סטטוס שיעור',
  'היי {{instructor_name}}, 👋

שמנו לב שלא עודכן סטטוס לשיעור שלך היום:
📚 מחזור: {{cycle_name}}
🕐 שעה: {{meeting_time}}
📍 סניף: {{branch_name}}

אפשר לעדכן בבקשה? 🙏

תודה,
דרך ההייטק',
  ARRAY['instructor_name', 'cycle_name', 'meeting_time', 'branch_name', 'meeting_date']
),
(
  'tpl-tomorrow-reminder',
  'תזכורת שיעור מחר',
  'both',
  'תזכורת - שיעור מחר',
  'היי {{instructor_name}}, 👋

תזכורת לשיעור מחר:
📚 מחזור: {{cycle_name}}
🕐 שעה: {{meeting_time}}
📍 סניף: {{branch_name}}

בהצלחה! 🌟

דרך ההייטק',
  ARRAY['instructor_name', 'cycle_name', 'meeting_time', 'branch_name', 'meeting_date']
),
(
  'tpl-free-text',
  'הודעה חופשית',
  'both',
  NULL,
  '{{custom_message}}',
  ARRAY['instructor_name', 'custom_message']
);

-- 4. Create indexes
CREATE INDEX IF NOT EXISTS idx_message_logs_instructor ON message_logs(instructor_id);
CREATE INDEX IF NOT EXISTS idx_message_logs_created ON message_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_templates_active ON message_templates(is_active) WHERE is_active = true;

COMMENT ON TABLE message_templates IS 'Templates for instructor messages';
COMMENT ON TABLE message_logs IS 'Log of all sent messages';
