import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { prisma } from '../utils/prisma.js';
import { broadcastWaSSE } from '../services/wa-events.js';
import { sendGreenApiMessage } from '../services/green-api-client.js';
import nodemailer from 'nodemailer';

const router = Router();

const GMAIL_USER = process.env.GMAIL_USER || 'info@hai.tech';
const GMAIL_PASS = process.env.GMAIL_PASS;

// Validation schemas
const whatsAppSchema = z.object({
  phone: z.string().min(1, 'Phone is required'),
  message: z.string().min(1, 'Message is required'),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
});

const emailSchema = z.object({
  to: z.string().email('Valid email is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
});

// Format phone number for Green API (Israel format)
function formatPhoneForWhatsApp(phone: string): string {
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // If starts with 0, replace with 972 (Israel)
  if (cleaned.startsWith('0')) {
    cleaned = '972' + cleaned.substring(1);
  }
  
  // If doesn't start with country code, assume Israel
  if (!cleaned.startsWith('972')) {
    cleaned = '972' + cleaned;
  }
  
  return cleaned + '@c.us';
}

function normalizeWhatsAppPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return digits;
}

async function saveGreenOutboundMessage(params: {
  phone: string;
  message: string;
  greenMessageId?: string | null;
  customerId?: string;
  customerName?: string;
}) {
  const normalizedPhone = normalizeWhatsAppPhone(params.phone);
  if (!normalizedPhone) return null;

  const waMessageId = params.greenMessageId ? `green:${params.greenMessageId}` : undefined;
  if (waMessageId) {
    const existing = await prisma.waMessage.findUnique({
      where: { waMessageId },
      select: { id: true },
    });
    if (existing) return existing;
  }

  let customerName = params.customerName;
  if (!customerName && params.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: params.customerId, deletedAt: null },
      select: { name: true },
    });
    customerName = customer?.name || undefined;
  }

  const now = new Date();
  let conversation = await prisma.waConversation.findFirst({
    where: { phone: normalizedPhone },
    orderBy: { lastMessageAt: 'desc' },
  });

  if (!conversation) {
    conversation = await prisma.waConversation.create({
      data: {
        phone: normalizedPhone,
        contactName: customerName || normalizedPhone,
        status: 'open',
        unreadCount: 0,
        lastMessageAt: now,
        lastMessagePreview: params.message.slice(0, 100),
        businessPhone: 'Green API',
        phoneNumberId: null,
        aiEnabled: false,
      },
    });
  }

  const waMessage = await prisma.waMessage.create({
    data: {
      conversationId: conversation.id,
      direction: 'outbound',
      content: params.message,
      waMessageId,
      status: 'sent',
      isAiGenerated: false,
    },
  });

  await prisma.waConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      lastMessagePreview: params.message.slice(0, 100),
      contactName: customerName || conversation.contactName || normalizedPhone,
      businessPhone: conversation.businessPhone || 'Green API',
      aiEnabled: false,
      updatedAt: now,
    },
  });

  broadcastWaSSE('new_message', {
    conversationId: conversation.id,
    message: waMessage,
    phone: normalizedPhone,
    contactName: customerName || conversation.contactName || normalizedPhone,
    provider: 'green',
  });

  return waMessage;
}

// Send WhatsApp message via Green API
router.post('/whatsapp', authenticate, async (req: Request, res: Response) => {
  try {
    const { phone, message, customerId, customerName } = whatsAppSchema.parse(req.body);

    const chatId = formatPhoneForWhatsApp(phone);
    const result = await sendGreenApiMessage(chatId, message);

    if (!result.success) {
      console.error('Green API error:', result.error);
      return res.status(502).json({
        error: 'Failed to send WhatsApp message',
        details: result.error
      });
    }

    console.log(`WhatsApp message sent to ${phone} via ${result.instanceId || 'unknown'}: ${result.messageId}`);

    await saveGreenOutboundMessage({
      phone,
      message,
      greenMessageId: result.messageId,
      customerId,
      customerName,
    });

    // Log to audit
    await logAudit({
      userId: (req as any).user?.id,
      userName: (req as any).user?.name || (req as any).user?.email,
      action: 'CREATE',
      entity: 'communication_whatsapp',
      entityId: customerId || result.messageId || 'unknown',
      newValue: { phone, message, chatId, customerId, customerName },
      req,
    });

    res.json({ success: true, messageId: result.messageId, greenInstanceId: result.instanceId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('WhatsApp send error:', error);
    res.status(500).json({ error: 'Failed to send WhatsApp message' });
  }
});

// Send email via Gmail SMTP
router.post('/email', authenticate, async (req: Request, res: Response) => {
  try {
    const { to, subject, body, customerId, customerName } = emailSchema.parse(req.body);

    if (!GMAIL_PASS) {
      return res.status(500).json({ 
        error: 'Email not configured',
        details: 'GMAIL_PASS must be set'
      });
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS,
      },
    });

    // Send email
    const result = await transporter.sendMail({
      from: `"Hai.Tech" <${GMAIL_USER}>`,
      to,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
    });

    console.log(`Email sent to ${to}:`, result.messageId);

    // Log to audit
    await logAudit({
      userId: (req as any).user?.id,
      userName: (req as any).user?.name || (req as any).user?.email,
      action: 'CREATE',
      entity: 'communication_email',
      entityId: customerId || result.messageId || 'unknown',
      newValue: { to, subject, bodyPreview: body.substring(0, 200), customerId, customerName },
      req,
    });

    res.json({ success: true, messageId: result.messageId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Email send error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

export const communicationRouter = router;
