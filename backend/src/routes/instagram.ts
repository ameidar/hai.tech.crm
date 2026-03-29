/**
 * Instagram DM Integration
 * Inbox for HaiTech CRM — דרך ההייטק
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import axios from 'axios';
import OpenAI from 'openai';

const router = Router();

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN || 'haitech-ig-verify-2026';
const PAGE_ACCESS_TOKEN = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || '';
const IG_USER_ID = process.env.INSTAGRAM_USER_ID || '17841413820029937';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── AI System Prompt ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `אתה נציג שירות לקוחות ידידותי של "דרך ההייטק" — עסק לחוגי תכנות לילדים.
תענה בעברית, בטון חם ומקצועי.
אם שאלו על מחיר — תגיד שנחזור אליהם עם פרטים.
אם שאלו לגבי רישום — תאסוף שם הילד, גיל, ועיר מגורים.
תשובות קצרות וברורות — לא יותר מ-3 משפטים.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function sendInstagramMessage(igsid: string, text: string): Promise<string | null> {
  if (!PAGE_ACCESS_TOKEN) {
    console.warn('[Instagram] No PAGE_ACCESS_TOKEN configured');
    return null;
  }
  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${IG_USER_ID}/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      { recipient: { id: igsid }, message: { text } }
    );
    return res.data?.message_id || null;
  } catch (err: any) {
    console.error('[Instagram] Send error:', err.response?.data || err.message);
    return null;
  }
}

async function getSenderProfile(igsid: string): Promise<{ name: string; username: string }> {
  try {
    if (PAGE_ACCESS_TOKEN) {
      const res = await axios.get(
        `https://graph.facebook.com/v19.0/${igsid}?fields=name,username&access_token=${PAGE_ACCESS_TOKEN}`
      );
      return {
        name: res.data.name || igsid,
        username: res.data.username || '',
      };
    }
  } catch {}
  return { name: igsid, username: '' };
}

async function getOrCreateConversation(igsid: string, senderName: string, senderUsername: string) {
  const rows = await prisma.$queryRaw<any[]>`
    INSERT INTO instagram_conversations (igsid, sender_name, sender_username, ig_user_id, last_message_at)
    VALUES (${igsid}, ${senderName}, ${senderUsername}, ${IG_USER_ID}, NOW())
    ON CONFLICT (igsid) DO UPDATE SET
      sender_name = EXCLUDED.sender_name,
      sender_username = EXCLUDED.sender_username,
      updated_at = NOW()
    RETURNING *
  `;
  return rows[0];
}

async function saveMessage(convId: string, direction: 'inbound' | 'outbound', content: string, msgId?: string, isAi = false) {
  const rows = await prisma.$queryRaw<any[]>`
    INSERT INTO instagram_messages (conversation_id, direction, content, msg_id, is_ai_generated)
    VALUES (${convId}::uuid, ${direction}, ${content}, ${msgId || null}, ${isAi})
    ON CONFLICT (msg_id) DO NOTHING
    RETURNING *
  `;
  return rows[0];
}

async function generateAIReply(igsid: string, _userMessage: string): Promise<string> {
  const conv = await prisma.$queryRaw<any[]>`
    SELECT m.* FROM instagram_messages m
    JOIN instagram_conversations c ON c.id = m.conversation_id
    WHERE c.igsid = ${igsid}
    ORDER BY m.created_at DESC LIMIT 10
  `;
  const history = conv.reverse().map((m: any) => ({
    role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
    content: m.content,
  }));

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
    max_tokens: 200,
  });
  return completion.choices[0].message.content || 'תודה על פנייתך! נחזור אליך בהקדם.';
}

// ─── Webhook Verification (GET) ──────────────────────────────────────────────
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Instagram] Webhook verified ✅');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ─── Webhook Incoming Messages (POST) ────────────────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  res.sendStatus(200); // Respond immediately
  const body = req.body;
  if (body.object !== 'instagram') return;

  for (const entry of body.entry || []) {
    // Support both `messaging` array (real webhooks) and `changes` array (Meta test button)
    const messagingEvents = entry.messaging || [];
    for (const change of entry.changes || []) {
      if (change.field === 'messages' && change.value?.sender) {
        messagingEvents.push({
          sender: change.value.sender,
          recipient: change.value.recipient,
          timestamp: change.value.timestamp,
          message: change.value.message,
        });
      }
    }

    for (const event of messagingEvents) {
      if (!event.message || event.message.is_echo) continue;

      const igsid = event.sender.id;
      // Skip our own messages
      if (igsid === IG_USER_ID) continue;

      const text = event.message.text || `[${event.message.attachments?.[0]?.type || 'attachment'}]`;
      const msgId = event.message.mid;

      // Get sender profile
      const profile = await getSenderProfile(igsid);

      // Upsert conversation
      const conv = await getOrCreateConversation(igsid, profile.name, profile.username);
      if (!conv) continue;

      // Save inbound message
      await saveMessage(conv.id, 'inbound', text, msgId);

      // Update conversation
      await prisma.$queryRaw`
        UPDATE instagram_conversations
        SET last_message = ${text}, last_message_at = NOW(), unread_count = unread_count + 1, updated_at = NOW()
        WHERE id = ${conv.id}::uuid
      `;

      // AI auto-reply if enabled
      if (conv.ai_enabled && PAGE_ACCESS_TOKEN) {
        try {
          const aiReply = await generateAIReply(igsid, text);
          const outMsgId = await sendInstagramMessage(igsid, aiReply);
          await saveMessage(conv.id, 'outbound', aiReply, outMsgId || undefined, true);
          await prisma.$queryRaw`
            UPDATE instagram_conversations
            SET last_message = ${aiReply}, last_message_at = NOW(), updated_at = NOW()
            WHERE id = ${conv.id}::uuid
          `;
        } catch (err: any) {
          console.error('[Instagram] AI reply error:', err.message);
        }
      }
    }
  }
});

// ─── API: List conversations ──────────────────────────────────────────────────
router.get('/conversations', authenticate, async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT * FROM instagram_conversations ORDER BY last_message_at DESC NULLS LAST LIMIT 100
    `;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Get messages ────────────────────────────────────────────────────────
router.get('/conversations/:id/messages', authenticate, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const rows = await prisma.$queryRaw`
      SELECT * FROM instagram_messages WHERE conversation_id = ${id}::uuid ORDER BY created_at ASC LIMIT 200
    `;
    await prisma.$queryRaw`UPDATE instagram_conversations SET unread_count = 0 WHERE id = ${id}::uuid`;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Send reply ──────────────────────────────────────────────────────────
router.post('/send', authenticate, async (req: Request, res: Response) => {
  const { conversation_id, igsid, text } = req.body;
  if (!text || !igsid) return res.status(400).json({ error: 'igsid and text required' });
  try {
    const msgId = await sendInstagramMessage(igsid, text);
    if (!msgId && PAGE_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Failed to send message — check INSTAGRAM_PAGE_ACCESS_TOKEN' });
    }
    const msg = await saveMessage(conversation_id, 'outbound', text, msgId || undefined, false);
    await prisma.$queryRaw`
      UPDATE instagram_conversations SET last_message = ${text}, last_message_at = NOW(), updated_at = NOW()
      WHERE id = ${conversation_id}::uuid
    `;
    res.json(msg || { ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Toggle AI ───────────────────────────────────────────────────────────
router.patch('/conversations/:id/ai', authenticate, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { aiEnabled } = req.body;
  await prisma.$queryRaw`UPDATE instagram_conversations SET ai_enabled = ${aiEnabled} WHERE id = ${id}::uuid`;
  res.json({ ok: true });
});

export const instagramRouter = router;
