import nodemailer from 'nodemailer';

// Green API configuration
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_API_BASE = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}`;

// Gmail configuration
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

// Create email transporter
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
});

export interface SendWhatsAppParams {
  phone: string;
  message: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  html?: boolean;
}

export interface MessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Format phone number for WhatsApp (Israel format)
 */
function formatPhoneForWhatsApp(phone: string): string {
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // If starts with 0, replace with 972
  if (cleaned.startsWith('0')) {
    cleaned = '972' + cleaned.substring(1);
  }
  
  // If doesn't start with country code, add 972
  if (!cleaned.startsWith('972')) {
    cleaned = '972' + cleaned;
  }
  
  return cleaned;
}

/**
 * Send WhatsApp message via Green API
 */
export async function sendWhatsApp(params: SendWhatsAppParams): Promise<MessageResult> {
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    return { success: false, error: 'Green API not configured' };
  }

  try {
    const chatId = formatPhoneForWhatsApp(params.phone) + '@c.us';
    
    const response = await fetch(`${GREEN_API_BASE}/sendMessage/${GREEN_API_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId,
        message: params.message,
      }),
    });

    const data = await response.json() as { idMessage?: string; message?: string };

    if (data.idMessage) {
      return { success: true, messageId: data.idMessage };
    } else {
      return { success: false, error: data.message || 'Unknown error' };
    }
  } catch (error: any) {
    console.error('WhatsApp send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send email via Gmail
 */
export async function sendEmail(params: SendEmailParams): Promise<MessageResult> {
  if (!GMAIL_USER || !GMAIL_PASS) {
    return { success: false, error: 'Gmail not configured' };
  }

  try {
    const info = await emailTransporter.sendMail({
      from: `"דרך ההייטק" <${GMAIL_USER}>`,
      to: params.to,
      subject: params.subject,
      [params.html ? 'html' : 'text']: params.body,
    });

    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Replace placeholders in template
 */
export function replacePlaceholders(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  }
  return result;
}

/**
 * Format time string for display
 */
export function formatTimeForDisplay(time: string | Date | null): string {
  if (!time) return '';
  
  if (typeof time === 'string') {
    if (time.includes('T')) {
      const date = new Date(time);
      return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
    }
    return time.substring(0, 5);
  }
  
  if (time instanceof Date) {
    return `${time.getUTCHours().toString().padStart(2, '0')}:${time.getUTCMinutes().toString().padStart(2, '0')}`;
  }
  
  return '';
}
