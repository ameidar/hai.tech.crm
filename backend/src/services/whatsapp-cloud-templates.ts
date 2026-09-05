import axios from 'axios';
import { prisma } from '../utils/prisma.js';

const WA_API_URL = 'https://graph.facebook.com/v20.0';
const DEFAULT_BUSINESS_PHONE = '+972533027763';
const DEFAULT_LANGUAGE = 'he';

export interface WhatsAppCloudResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface WhatsAppTemplateParam {
  type: 'text';
  text: string;
}

export interface WhatsAppTemplateButton {
  type: 'button';
  sub_type: 'quick_reply' | 'url';
  index: string;
  parameters: Array<
    | { type: 'payload'; payload: string }
    | { type: 'text'; text: string }
  >;
}

export interface WhatsAppTemplatePayload {
  templateName: string;
  phone: string;
  contactName?: string | null;
  bodyParameters?: string[];
  preview: string;
  language?: string;
  phoneNumberId?: string;
  businessPhone?: string;
  buttons?: WhatsAppTemplateButton[];
}

export interface WhatsAppTextPayload {
  phone: string;
  message: string;
  contactName?: string | null;
  phoneNumberId?: string | null;
  businessPhone?: string | null;
  isAiGenerated?: boolean;
}

export function normalizeWhatsAppCloudPhone(phone: string | null | undefined): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return `972${digits}`;
}

export function templateText(value: string | number | null | undefined, fallback: string): string {
  const trimmed = String(value ?? '').trim();
  return trimmed || fallback;
}

export function sanitizeWhatsAppTemplateText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' | ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/(?:\s*\|\s*){2,}/g, ' | ')
    .trim();
}

function resolvePhoneNumberId(explicit?: string | null): string {
  return explicit || process.env.WA_REMINDER_PHONE_NUMBER_ID || process.env.WA_PHONE_NUMBER_ID || '';
}

function resolveBusinessPhone(explicit?: string | null): string {
  return explicit || process.env.WA_REMINDER_BUSINESS_PHONE || DEFAULT_BUSINESS_PHONE;
}

function resolveToken(): string {
  return process.env.WA_ACCESS_TOKEN || '';
}

async function getOrCreateConversation(params: {
  phone: string;
  contactName?: string | null;
  phoneNumberId: string;
  businessPhone: string;
  preview: string;
}) {
  const now = new Date();
  let conv = await prisma.waConversation.findFirst({
    where: { phone: params.phone, phoneNumberId: params.phoneNumberId },
    orderBy: { lastMessageAt: 'desc' },
  });

  if (!conv) {
    conv = await prisma.waConversation.create({
      data: {
        phone: params.phone,
        contactName: params.contactName || params.phone,
        status: 'open',
        unreadCount: 0,
        lastMessageAt: now,
        lastMessagePreview: params.preview.slice(0, 100),
        businessPhone: params.businessPhone,
        phoneNumberId: params.phoneNumberId,
        aiEnabled: false,
      },
    });
  }

  return conv;
}

async function logOutboundMessage(params: {
  phone: string;
  contactName?: string | null;
  phoneNumberId: string;
  businessPhone: string;
  content: string;
  waMessageId?: string | null;
  isAiGenerated?: boolean;
}) {
  const now = new Date();
  const conv = await getOrCreateConversation({
    phone: params.phone,
    contactName: params.contactName,
    phoneNumberId: params.phoneNumberId,
    businessPhone: params.businessPhone,
    preview: params.content,
  });

  const msg = await prisma.waMessage.create({
    data: {
      conversationId: conv.id,
      direction: 'outbound',
      content: params.content,
      waMessageId: params.waMessageId || undefined,
      status: 'sent',
      isAiGenerated: params.isAiGenerated || false,
    },
  });

  await prisma.waConversation.update({
    where: { id: conv.id },
    data: {
      lastMessageAt: now,
      lastMessagePreview: params.content.slice(0, 100),
      contactName: params.contactName || conv.contactName,
      businessPhone: conv.businessPhone || params.businessPhone,
      phoneNumberId: conv.phoneNumberId || params.phoneNumberId,
      aiEnabled: false,
      updatedAt: now,
    },
  });

  return msg;
}

export async function sendWhatsAppCloudTemplate(params: WhatsAppTemplatePayload): Promise<WhatsAppCloudResult> {
  const phone = normalizeWhatsAppCloudPhone(params.phone);
  if (!phone) return { success: false, error: 'Invalid phone' };

  const phoneNumberId = resolvePhoneNumberId(params.phoneNumberId);
  const token = resolveToken();
  const businessPhone = resolveBusinessPhone(params.businessPhone);
  if (!phoneNumberId || !token) return { success: false, error: 'WhatsApp Cloud API not configured' };

  try {
    const components: any[] = [];
    if (params.bodyParameters?.length) {
      components.push({
        type: 'body',
        parameters: params.bodyParameters.map(text => ({
          type: 'text',
          text: sanitizeWhatsAppTemplateText(text),
        })),
      });
    }
    if (params.buttons?.length) {
      components.push(...params.buttons);
    }

    const resp = await axios.post(
      `${WA_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: params.templateName,
          language: { code: params.language || process.env.WA_REMINDER_TEMPLATE_LANGUAGE || DEFAULT_LANGUAGE },
          ...(components.length ? { components } : {}),
        },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );

    const waId = resp.data?.messages?.[0]?.id || null;
    const msg = await logOutboundMessage({
      phone,
      contactName: params.contactName,
      phoneNumberId,
      businessPhone,
      content: params.preview,
      waMessageId: waId,
    });

    return { success: true, messageId: msg.waMessageId || waId || undefined };
  } catch (error: any) {
    const details = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error(`[WACloud] Template ${params.templateName} send failed:`, error.response?.data || error.message);
    return { success: false, error: details };
  }
}

export async function sendWhatsAppCloudText(params: WhatsAppTextPayload): Promise<WhatsAppCloudResult> {
  const phone = normalizeWhatsAppCloudPhone(params.phone);
  if (!phone) return { success: false, error: 'Invalid phone' };

  const phoneNumberId = resolvePhoneNumberId(params.phoneNumberId);
  const token = resolveToken();
  const businessPhone = resolveBusinessPhone(params.businessPhone);
  if (!phoneNumberId || !token) return { success: false, error: 'WhatsApp Cloud API not configured' };

  try {
    const resp = await axios.post(
      `${WA_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: params.message },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );

    const waId = resp.data?.messages?.[0]?.id || null;
    const msg = await logOutboundMessage({
      phone,
      contactName: params.contactName,
      phoneNumberId,
      businessPhone,
      content: params.message,
      waMessageId: waId,
      isAiGenerated: params.isAiGenerated,
    });

    return { success: true, messageId: msg.waMessageId || waId || undefined };
  } catch (error: any) {
    const details = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error('[WACloud] Text send failed:', error.response?.data || error.message);
    return { success: false, error: details };
  }
}
