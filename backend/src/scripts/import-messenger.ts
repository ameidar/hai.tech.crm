/**
 * Import existing Facebook Messenger conversations into HaiTech CRM
 * Usage: cd backend && npx tsx src/scripts/import-messenger.ts
 */

import { PrismaClient } from '@prisma/client';

const PAGE_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN!;
const PAGE_ID = '124822734055754';
const BASE = 'https://graph.facebook.com/v19.0';

const prisma = new PrismaClient();

async function gql(url: string): Promise<any> {
  const res = await fetch(url);
  return res.json();
}

async function fetchAllConversations(): Promise<any[]> {
  const all: any[] = [];
  let url: string | null = `${BASE}/me/conversations?platform=messenger&fields=id,participants,updated_time,snippet&limit=25&access_token=${PAGE_TOKEN}`;
  while (url) {
    const json = await gql(url);
    if (json.error) { console.error('API error:', json.error.message); break; }
    all.push(...(json.data || []));
    url = json.paging?.next || null;
    console.log(`  Fetched ${all.length} conversations...`);
  }
  return all;
}

async function fetchMessages(convId: string): Promise<any[]> {
  const all: any[] = [];
  let url: string | null = `${BASE}/${convId}/messages?fields=id,message,from,created_time&limit=50&access_token=${PAGE_TOKEN}`;
  while (url) {
    const json = await gql(url);
    if (json.error) break;
    all.push(...(json.data || []));
    url = json.paging?.next || null;
  }
  return all.reverse(); // oldest first
}

async function main() {
  if (!PAGE_TOKEN) { console.error('❌ MESSENGER_PAGE_ACCESS_TOKEN not set'); process.exit(1); }

  console.log('🔄 Importing Facebook Messenger conversations...\n');

  const conversations = await fetchAllConversations();
  console.log(`\n📋 Total conversations: ${conversations.length}\n`);

  let imported = 0;
  let msgCount = 0;

  for (const conv of conversations) {
    const human = (conv.participants?.data || []).find((p: any) => p.id !== PAGE_ID);
    if (!human) continue;

    const psid = human.id;
    const senderName = human.name || psid;
    const snippet = conv.snippet || null;
    const updatedAt = conv.updated_time ? new Date(conv.updated_time) : new Date();

    // Upsert conversation
    const rows = await prisma.$queryRaw<any[]>`
      INSERT INTO messenger_conversations (psid, sender_name, page_id, last_message, last_message_at, unread_count)
      VALUES (${psid}, ${senderName}, ${PAGE_ID}, ${snippet}, ${updatedAt}, 0)
      ON CONFLICT (psid) DO UPDATE SET
        sender_name = EXCLUDED.sender_name,
        last_message = COALESCE(EXCLUDED.last_message, messenger_conversations.last_message),
        last_message_at = EXCLUDED.last_message_at,
        updated_at = NOW()
      RETURNING id
    `;
    const convId = rows[0]?.id;
    if (!convId) continue;

    // Fetch messages
    const messages = await fetchMessages(conv.id);
    let convMsgCount = 0;
    for (const msg of messages) {
      if (!msg.message || !msg.id) continue;
      const direction = msg.from?.id === PAGE_ID ? 'outbound' : 'inbound';
      const createdAt = new Date(msg.created_time);
      await prisma.$queryRaw`
        INSERT INTO messenger_messages (conversation_id, direction, content, msg_id, is_ai_generated, created_at)
        VALUES (${convId}::uuid, ${direction}, ${msg.message}, ${msg.id}, false, ${createdAt})
        ON CONFLICT (msg_id) DO NOTHING
      `;
      convMsgCount++;
    }

    msgCount += convMsgCount;
    imported++;
    console.log(`  ✅ ${senderName} — ${convMsgCount} הודעות`);
  }

  console.log(`\n🎉 Done! ${imported} שיחות, ${msgCount} הודעות יובאו`);
  await prisma.$disconnect();
}

main().catch(async err => {
  console.error('❌', err.message);
  await prisma.$disconnect();
  process.exit(1);
});
