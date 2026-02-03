import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import nodemailer from 'nodemailer';

const router = Router();

// Environment variables
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
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

// Send WhatsApp message via Green API
router.post('/whatsapp', authenticate, async (req: Request, res: Response) => {
  try {
    const { phone, message, customerId, customerName } = whatsAppSchema.parse(req.body);

    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
      return res.status(500).json({ 
        error: 'Green API not configured',
        details: 'GREEN_API_INSTANCE_ID and GREEN_API_TOKEN must be set'
      });
    }

    const chatId = formatPhoneForWhatsApp(phone);
    const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message }),
    });

    const data = await response.json() as { idMessage?: string; [key: string]: any };

    if (!response.ok) {
      console.error('Green API error:', data);
      return res.status(response.status).json({ 
        error: 'Failed to send WhatsApp message',
        details: data
      });
    }

    console.log(`WhatsApp message sent to ${phone}:`, data);

    // Log to audit
    await logAudit({
      userId: (req as any).user?.id,
      userName: (req as any).user?.name || (req as any).user?.email,
      action: 'CREATE',
      entity: 'communication_whatsapp',
      entityId: customerId || data.idMessage || 'unknown',
      newValue: { phone, message, chatId, customerId, customerName },
      req,
    });

    res.json({ success: true, messageId: data.idMessage });
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
