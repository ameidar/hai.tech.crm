/**
 * WhatsApp Cloud API Integration
 * Inbox management for HaiTech CRM
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { config } from '../config.js';
import jwt from 'jsonwebtoken';
import OpenAI from 'openai';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

// ============================================================
// Config
// ============================================================
const WA_API_URL = 'https://graph.facebook.com/v19.0';
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID!;
const ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN!;
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || 'haitech-wa-verify-2026';
const AI_IDLE_MS = 10 * 60 * 1000; // 10 min after last message → extract lead summary

// Multi-number support: phoneNumberId → wabaId mapping
const PHONE_WABA_MAP: Record<string, string> = {
  [process.env.WA_PHONE_NUMBER_ID || '']: process.env.WA_WABA_ID || process.env.WA_CLOUD_WABA_ID || '',
  [process.env.WA_PHONE_NUMBER_ID_2 || '']: process.env.WA_WABA_ID_2 || '',
};
function getWabaId(phoneNumberId?: string | null): string {
  if (phoneNumberId && PHONE_WABA_MAP[phoneNumberId]) return PHONE_WABA_MAP[phoneNumberId];
  return process.env.WA_WABA_ID || process.env.WA_CLOUD_WABA_ID || '';
}
// All active phone numbers (for new conversation picker)
const ACTIVE_PHONES: { phoneNumberId: string; businessPhone: string; label: string }[] = [
  { phoneNumberId: process.env.WA_PHONE_NUMBER_ID || '', businessPhone: '+972533027763', label: 'Bot Hai.tech (+972 53 302 7763)' },
  ...(process.env.WA_PHONE_NUMBER_ID_2 ? [{ phoneNumberId: process.env.WA_PHONE_NUMBER_ID_2, businessPhone: '+972533009742', label: 'Bot Hai.Tech (+972 53 300 9742)' }] : []),
];

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Load bot data
const DATA_DIR = path.join(__dirname, '../data');
let systemPrompt = '';
let knowledgeBase: any = {};
try {
  systemPrompt = fs.readFileSync(path.join(DATA_DIR, 'wa_system_prompt.md'), 'utf8');
  knowledgeBase = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wa_knowledge_base.json'), 'utf8'));
  console.log('[WA] System prompt and knowledge base loaded');
} catch (e) {
  console.warn('[WA] Could not load system prompt / knowledge base:', e);
}

// SSE clients for real-time updates
const sseClients = new Set<Response>();

function broadcastSSE(event: string, data: any) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try { client.write(msg); } catch {}
  });
}

// ============================================================
// Meta WhatsApp Cloud API helper
// ============================================================
async function sendWhatsAppMessage(phone: string, text: string, phoneNumberId?: string | null): Promise<string | null> {
  const fromId = phoneNumberId || PHONE_NUMBER_ID;
  try {
    const res = await axios.post(
      `${WA_API_URL}/${fromId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text }
      },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    return res.data?.messages?.[0]?.id || null;
  } catch (err: any) {
    console.error('[WA] Send error:', err.response?.data || err.message);
    return null;
  }
}

// ============================================================
// AI Response generation (mirrors bot logic)
// ============================================================
async function generateAIReply(conversationId: string): Promise<string | null> {
  const messages = await prisma.waMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 20
  });

  const conv = await prisma.waConversation.findUnique({ where: { id: conversationId } });
  if (!conv) return null;

  const fullSystemPrompt = `${systemPrompt}

---
## Knowledge Base (מידע על דרך ההייטק)

${JSON.stringify(knowledgeBase, null, 2)}

---
## הקשר שיחה

מספר טלפון: ${conv.phone}
${conv.contactName ? `שם: ${conv.contactName}` : ''}
${conv.childName ? `שם הילד: ${conv.childName}` : ''}
${conv.summary ? `סיכום קודם: ${conv.summary}` : ''}
`;

  const chatMessages: any[] = [{ role: 'system', content: fullSystemPrompt }];
  for (const m of messages.slice(-15)) {
    chatMessages.push({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.content
    });
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: chatMessages,
    max_tokens: 500,
    temperature: 0.7
  });

  return completion.choices[0].message.content || null;
}

// ============================================================
// Lead extraction (runs after idle)
// ============================================================
async function extractLeadData(conversationId: string) {
  const messages = await prisma.waMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 30
  });

  if (messages.length === 0) return;

  const text = messages.map(m =>
    `${m.direction === 'inbound' ? 'לקוח' : 'נציג'}: ${m.content}`
  ).join('\n');

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `נתח שיחת וואטסאפ וחלץ מידע. החזר JSON בלבד:
{
  "lead_name": "שם מלא או null",
  "lead_email": "מייל או null",
  "child_name": "שם הילד או null",
  "child_age": null,
  "interests": ["..."],
  "lead_type": "parent/institution/teacher/other",
  "summary": "סיכום בשורה אחת"
}`
        },
        { role: 'user', content: text }
      ],
      response_format: { type: 'json_object' }
    });

    const data = JSON.parse(res.choices[0].message.content || '{}');
    await prisma.waConversation.update({
      where: { id: conversationId },
      data: {
        leadName: data.lead_name,
        leadEmail: data.lead_email,
        childName: data.child_name,
        childAge: data.child_age,
        interests: data.interests ? JSON.stringify(data.interests) : undefined,
        leadType: data.lead_type,
        summary: data.summary
      }
    });
    console.log(`[WA] Lead extracted for ${conversationId}`);
  } catch (e) {
    console.error('[WA] Lead extraction failed:', e);
  }
}

// Track idle timers per conversation
const idleTimers = new Map<string, NodeJS.Timeout>();

function scheduleLeadExtraction(conversationId: string) {
  const existing = idleTimers.get(conversationId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    extractLeadData(conversationId);
    idleTimers.delete(conversationId);
  }, AI_IDLE_MS);
  idleTimers.set(conversationId, timer);
}

// ============================================================
// Routes
// ============================================================

// ── GET /api/wa/webhook — Meta verification
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WA] Webhook verified by Meta');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── POST /api/wa/webhook — Incoming messages from Meta
router.post('/webhook', async (req: Request, res: Response) => {
  res.sendStatus(200); // Respond immediately to Meta

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;

        // Status updates (delivered/read)
        for (const status of value.statuses || []) {
          await prisma.waMessage.updateMany({
            where: { waMessageId: status.id },
            data: { status: status.status }
          });
          broadcastSSE('message_status', { waMessageId: status.id, status: status.status });
        }

        // Incoming messages
        const businessPhone = value.metadata?.display_phone_number ? '+' + value.metadata.display_phone_number.replace(/\D/g, '') : undefined;
        const bizPhoneNumberId = value.metadata?.phone_number_id;

        for (const msg of value.messages || []) {
          if (msg.type !== 'text') continue; // Only text for now

          const phone = msg.from;
          const text = msg.text?.body || '';
          const waMessageId = msg.id;
          const contactName = value.contacts?.[0]?.profile?.name;

          // Dedup
          const existing = await prisma.waMessage.findUnique({ where: { waMessageId } });
          if (existing) continue;

          // Get or create conversation (unique per sender+businessPhone combo)
          let conv = await prisma.waConversation.findFirst({ where: { phone, phoneNumberId: bizPhoneNumberId || undefined } });
          if (!conv) {
            // fallback: find by phone only if no bizPhoneNumberId
            conv = await prisma.waConversation.findFirst({ where: { phone, phoneNumberId: null } }) || null;
          }
          if (!conv) {
            conv = await prisma.waConversation.create({
              data: { phone, contactName, businessPhone, phoneNumberId: bizPhoneNumberId }
            });
          } else if (!conv.businessPhone && businessPhone) {
            conv = await prisma.waConversation.update({
              where: { id: conv.id },
              data: { businessPhone, phoneNumberId: bizPhoneNumberId }
            });
          }

          // Store message
          const newMsg = await prisma.waMessage.create({
            data: {
              conversationId: conv.id,
              direction: 'inbound',
              content: text,
              waMessageId,
              status: 'received'
            }
          });

          // Update conversation
          await prisma.waConversation.update({
            where: { id: conv.id },
            data: {
              unreadCount: { increment: 1 },
              lastMessageAt: new Date(),
              lastMessagePreview: text.slice(0, 100),
              contactName: contactName || conv.contactName,
              updatedAt: new Date()
            }
          });

          broadcastSSE('new_message', {
            conversationId: conv.id,
            message: { ...newMsg, direction: 'inbound' },
            phone,
            contactName
          });

          // AI auto-reply (if enabled)
          if (conv.aiEnabled) {
            try {
              const reply = await generateAIReply(conv.id);
              if (reply) {
                const waId = await sendWhatsAppMessage(phone, reply);
                const botMsg = await prisma.waMessage.create({
                  data: {
                    conversationId: conv.id,
                    direction: 'outbound',
                    content: reply,
                    waMessageId: waId || undefined,
                    status: 'sent',
                    isAiGenerated: true
                  }
                });
                await prisma.waConversation.update({
                  where: { id: conv.id },
                  data: {
                    lastMessageAt: new Date(),
                    lastMessagePreview: reply.slice(0, 100),
                    updatedAt: new Date()
                  }
                });
                broadcastSSE('new_message', { conversationId: conv.id, message: botMsg });
              }
            } catch (e) {
              console.error('[WA] AI reply error:', e);
            }
          }

          scheduleLeadExtraction(conv.id);
        }
      }
    }
  } catch (err) {
    console.error('[WA] Webhook error:', err);
  }
});

// ── SSE — Real-time updates (token via query param for EventSource)
router.get('/events', (req: Request, res: Response) => {
  // EventSource can't send headers, so we accept token as query param
  const token = req.query.token as string || req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).end(); return; }
  try {
    jwt.verify(token, config.jwt.secret);
  } catch { res.status(401).end(); return; }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  res.write('event: connected\ndata: {}\n\n');

  req.on('close', () => sseClients.delete(res));
});

// ── POST /api/wa/templates — Create a new template in Meta
router.post('/templates', authenticate, async (req: Request, res: Response) => {
  try {
    const { name, category, language, headerText, bodyText, footerText, buttons, examples, phoneNumberId: reqPhoneId } = req.body;
    if (!name || !bodyText) return res.status(400).json({ error: 'Missing name or bodyText' });

    const wabaId = getWabaId(reqPhoneId);

    // Count variables in text ({{1}}, {{2}}, ...)
    const countVars = (text: string) => [...new Set(text.match(/\{\{\d+\}\}/g) || [])].length;

    const components: any[] = [];
    if (headerText) {
      const headerVars = countVars(headerText);
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: headerText,
        ...(headerVars > 0 && {
          example: { header_text: Array(headerVars).fill('ערך') }
        })
      });
    }

    const bodyVarCount = countVars(bodyText);
    const bodyExamples = examples && examples.length > 0
      ? examples
      : Array(bodyVarCount).fill('דוגמה');

    components.push({
      type: 'BODY',
      text: bodyText,
      ...(bodyVarCount > 0 && {
        example: { body_text: [bodyExamples] }
      })
    });

    if (footerText) components.push({ type: 'FOOTER', text: footerText });
    if (buttons && buttons.length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: buttons.map((b: any) => ({ type: b.type || 'QUICK_REPLY', text: b.text }))
      });
    }

    const resp = await axios.post(
      `${WA_API_URL}/${wabaId}/message_templates`,
      {
        name: name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        language: language || 'he',
        category: category || 'MARKETING',
        components
      },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );

    res.json({ id: resp.data.id, status: resp.data.status, name: resp.data.name });
  } catch (err: any) {
    console.error('[WA] Create template error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create template', details: err.response?.data });
  }
});

// ── GET /api/wa/templates — Fetch approved templates from Meta
router.get('/templates', authenticate, async (req: Request, res: Response) => {
  try {
    const phoneNumberId = req.query.phoneNumberId as string | undefined;
    const wabaId = getWabaId(phoneNumberId);
    const resp = await axios.get(
      `${WA_API_URL}/${wabaId}/message_templates`,
      {
        params: { fields: 'name,status,language,components', limit: 100 },
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      }
    );
    const approved = (resp.data.data || []).filter((t: any) => t.status === 'APPROVED');
    res.json(approved);
  } catch (err: any) {
    console.error('[WA] Templates fetch error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// ── POST /api/wa/send-template — Send a template message
router.post('/send-template', authenticate, async (req: Request, res: Response) => {
  try {
    const { conversationId, phone: phoneParam, contactName, templateName, language, variables, previewText, fromPhoneNumberId } = req.body;
    if (!templateName) return res.status(400).json({ error: 'Missing templateName' });
    if (!conversationId && !phoneParam) return res.status(400).json({ error: 'Missing conversationId or phone' });

    let conv;
    if (conversationId) {
      conv = await prisma.waConversation.findUnique({ where: { id: conversationId } });
    } else {
      // Normalize phone (052... → 97252...)
      const phone = phoneParam.replace(/\D/g, '').replace(/^0/, '972');
      conv = await prisma.waConversation.findFirst({ where: { phone } });
      if (!conv) {
        const usePhoneId = fromPhoneNumberId || PHONE_NUMBER_ID;
        const activePh = ACTIVE_PHONES.find(p => p.phoneNumberId === usePhoneId);
        conv = await prisma.waConversation.create({
          data: { phone, contactName: contactName || phone, phoneNumberId: usePhoneId, businessPhone: activePh?.businessPhone || '+972533027763' }
        });
      }
    }
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    // Build template components with variables
    const components: any[] = [];
    if (variables && variables.length > 0) {
      components.push({
        type: 'body',
        parameters: variables.map((v: string) => ({ type: 'text', text: v }))
      });
    }

    // Send via Meta API (use conversation's phone number ID if available)
    const fromPhoneNumberId = conv.phoneNumberId || PHONE_NUMBER_ID;
    let waId: string | null = null;
    try {
      const resp = await axios.post(
        `${WA_API_URL}/${fromPhoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: conv.phone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language || 'he' },
            ...(components.length > 0 && { components })
          }
        },
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      waId = resp.data?.messages?.[0]?.id || null;
    } catch (err: any) {
      console.error('[WA] Template send error:', err.response?.data || err.message);
      return res.status(500).json({ error: 'Failed to send template via Meta', details: err.response?.data });
    }

    // Store message in DB
    const content = previewText || `[תבנית: ${templateName}]`;
    const msg = await prisma.waMessage.create({
      data: {
        conversationId,
        direction: 'outbound',
        content,
        waMessageId: waId || undefined,
        status: 'sent',
        isAiGenerated: false
      }
    });

    await prisma.waConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: content.slice(0, 100),
        updatedAt: new Date()
      }
    });

    broadcastSSE('new_message', { conversationId, message: msg });
    res.json(msg);
  } catch (err) {
    console.error('[WA] send-template error:', err);
    res.status(500).json({ error: 'Failed to send template' });
  }
});

// ── GET /api/wa/phones — List active WhatsApp phone numbers
router.get('/phones', authenticate, (_req: Request, res: Response) => {
  res.json(ACTIVE_PHONES.filter(p => p.phoneNumberId));
});

// ── GET /api/wa/conversations — List all conversations
router.get('/conversations', authenticate, async (req: Request, res: Response) => {
  try {
    const conversations = await prisma.waConversation.findMany({
      orderBy: { lastMessageAt: 'desc' },
      include: {
        _count: { select: { messages: true } }
      }
    });
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// ── GET /api/wa/conversations/:id/messages
router.get('/conversations/:id/messages', authenticate, async (req: Request, res: Response) => {
  try {
    const messages = await prisma.waMessage.findMany({
      where: { conversationId: req.params.id },
      orderBy: { createdAt: 'asc' }
    });

    // Mark as read
    await prisma.waConversation.update({
      where: { id: req.params.id },
      data: { unreadCount: 0 }
    });

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ── PATCH /api/wa/conversations/:id — Update conversation (status, aiEnabled, etc.)
router.patch('/conversations/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { status, aiEnabled, contactName } = req.body;
    const conv = await prisma.waConversation.update({
      where: { id: req.params.id },
      data: {
        ...(status !== undefined && { status }),
        ...(aiEnabled !== undefined && { aiEnabled }),
        ...(contactName !== undefined && { contactName })
      }
    });
    broadcastSSE('conversation_updated', conv);
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

// ── POST /api/wa/send — Send manual message
router.post('/send', authenticate, async (req: Request, res: Response) => {
  try {
    const { conversationId, text } = req.body;
    if (!conversationId || !text) {
      return res.status(400).json({ error: 'Missing conversationId or text' });
    }

    const conv = await prisma.waConversation.findUnique({ where: { id: conversationId } });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const waId = await sendWhatsAppMessage(conv.phone, text, conv.phoneNumberId);
    const msg = await prisma.waMessage.create({
      data: {
        conversationId,
        direction: 'outbound',
        content: text,
        waMessageId: waId || undefined,
        status: 'sent',
        isAiGenerated: false
      }
    });

    await prisma.waConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: text.slice(0, 100),
        updatedAt: new Date()
      }
    });

    broadcastSSE('new_message', { conversationId, message: msg });
    scheduleLeadExtraction(conversationId);
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
