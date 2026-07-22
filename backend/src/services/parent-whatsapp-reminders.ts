import axios from 'axios';
import { prisma } from '../utils/prisma.js';
import type { ParentReminderData } from './email/templates.js';

const WA_API_URL = 'https://graph.facebook.com/v20.0';

function normalizeWhatsAppPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return `972${digits}`;
}

function templateText(value: string | null | undefined, fallback: string): string {
  const trimmed = (value || '').trim();
  return trimmed || fallback;
}

export function buildParentReminderTemplateVariables(data: ParentReminderData): string[] {
  return [
    templateText(data.parentName, 'שלום'),
    templateText(data.studentName, 'התלמיד/ה'),
    templateText(data.className, 'השיעור'),
    templateText(data.date, 'מחר'),
    templateText(data.time, 'השעה תעודכן בהמשך'),
    templateText(data.location, 'אונליין'),
    templateText(data.instructorName, 'צוות HaiTech'),
    templateText(data.zoomLink, 'אין קישור זום לשיעור זה'),
  ];
}

export function buildParentReminderPreview(data: ParentReminderData, templateName: string): string {
  const location = data.zoomLink ? `קישור: ${data.zoomLink}` : `מיקום: ${data.location}`;
  return `[תבנית: ${templateName}] תזכורת ל-${data.studentName}: ${data.className}, ${data.date} בשעה ${data.time}. ${location}`;
}

export async function sendParentWhatsAppReminder(params: {
  phone?: string | null;
  contactName?: string | null;
  data: ParentReminderData;
}): Promise<{ sent: boolean; skipped?: string; messageId?: string }> {
  if (process.env.PARENT_REMINDER_WA_ENABLED !== 'true') {
    return { sent: false, skipped: 'disabled' };
  }

  if (!params.phone) return { sent: false, skipped: 'missing_phone' };

  const phone = normalizeWhatsAppPhone(params.phone);
  if (!phone) return { sent: false, skipped: 'invalid_phone' };

  const templateName = process.env.PARENT_REMINDER_WA_TEMPLATE_NAME || 'parent_lesson_reminder';
  const language = process.env.PARENT_REMINDER_WA_TEMPLATE_LANGUAGE || 'he';
  const phoneNumberId = process.env.PARENT_REMINDER_WA_PHONE_NUMBER_ID || process.env.WA_PHONE_NUMBER_ID || '';
  const token = process.env.WA_ACCESS_TOKEN || '';
  const businessPhone = process.env.PARENT_REMINDER_WA_BUSINESS_PHONE || '+972533027763';

  if (!phoneNumberId || !token) {
    return { sent: false, skipped: 'missing_meta_config' };
  }

  const variables = buildParentReminderTemplateVariables(params.data);
  const preview = buildParentReminderPreview(params.data, templateName);

  const resp = await axios.post(
    `${WA_API_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components: [{
          type: 'body',
          parameters: variables.map(text => ({ type: 'text', text })),
        }],
      },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );

  const waId = resp.data?.messages?.[0]?.id || null;
  const now = new Date();
  let conv = await prisma.waConversation.findFirst({
    where: { phone, phoneNumberId },
    orderBy: { lastMessageAt: 'desc' },
  });

  if (!conv) {
    conv = await prisma.waConversation.create({
      data: {
        phone,
        contactName: params.contactName || params.data.parentName || phone,
        status: 'open',
        unreadCount: 0,
        lastMessageAt: now,
        lastMessagePreview: preview.slice(0, 100),
        businessPhone,
        phoneNumberId,
        aiEnabled: false,
      },
    });
  }

  const msg = await prisma.waMessage.create({
    data: {
      conversationId: conv.id,
      direction: 'outbound',
      content: preview,
      waMessageId: waId || undefined,
      status: 'sent',
      isAiGenerated: false,
    },
  });

  await prisma.waConversation.update({
    where: { id: conv.id },
    data: {
      lastMessageAt: now,
      lastMessagePreview: preview.slice(0, 100),
      contactName: params.contactName || params.data.parentName || conv.contactName,
      businessPhone: conv.businessPhone || businessPhone,
      phoneNumberId: conv.phoneNumberId || phoneNumberId,
      aiEnabled: false,
      updatedAt: now,
    },
  });

  return { sent: true, messageId: msg.waMessageId || waId || undefined };
}
