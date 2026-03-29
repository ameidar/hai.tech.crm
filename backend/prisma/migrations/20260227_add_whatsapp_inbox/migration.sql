CREATE TYPE "WaMessageDirection" AS ENUM ('inbound', 'outbound');
CREATE TYPE "WaConversationStatus" AS ENUM ('open', 'pending', 'closed');

CREATE TABLE "wa_conversations" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "phone" TEXT NOT NULL,
  "contact_name" TEXT,
  "status" "WaConversationStatus" NOT NULL DEFAULT 'open',
  "unread_count" INTEGER NOT NULL DEFAULT 0,
  "last_message_at" TIMESTAMPTZ,
  "last_message_preview" TEXT,
  "lead_name" TEXT,
  "lead_email" TEXT,
  "child_name" TEXT,
  "child_age" INTEGER,
  "interests" TEXT,
  "lead_type" TEXT,
  "summary" TEXT,
  "ai_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "wa_conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wa_conversations_phone_key" ON "wa_conversations"("phone");

CREATE TABLE "wa_messages" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "conversation_id" TEXT NOT NULL,
  "direction" "WaMessageDirection" NOT NULL,
  "content" TEXT NOT NULL,
  "wa_message_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'sent',
  "tokens_used" INTEGER,
  "is_ai_generated" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "wa_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wa_messages_wa_message_id_key" ON "wa_messages"("wa_message_id");
CREATE INDEX "idx_wa_messages_conv" ON "wa_messages"("conversation_id", "created_at" DESC);
CREATE INDEX "idx_wa_conv_last_msg" ON "wa_conversations"("last_message_at" DESC);

ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "wa_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
