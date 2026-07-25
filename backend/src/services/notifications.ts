import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { sendGreenApiMessage } from './green-api-client.js';
import { prisma } from '../utils/prisma.js';

// Gmail SMTP transporter
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.gmailUser,
    pass: config.gmailAppPassword,
  },
});

// Format phone number for WhatsApp
// Accepts phone number OR pre-formatted chatId (e.g. "120363353459332838@g.us")
function formatPhoneForWhatsApp(phone: string): string {
  // Already a formatted chat ID (group or individual)
  if (phone.includes('@')) return phone;

  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // Israeli numbers: remove leading 0 and add 972
  if (cleaned.startsWith('0')) {
    cleaned = '972' + cleaned.substring(1);
  }
  
  // If no country code, assume Israeli
  if (cleaned.length === 9) {
    cleaned = '972' + cleaned;
  }
  
  return `${cleaned}@c.us`;
}

// Send WhatsApp message
export async function sendWhatsAppMessage(phone: string, message: string): Promise<boolean> {
  try {
    const chatId = formatPhoneForWhatsApp(phone);
    const result = await sendGreenApiMessage(chatId, message);
    if (!result.success) {
      console.error('[NOTIFICATION] WhatsApp send failed:', result.error);
      return false;
    }

    console.log(`[NOTIFICATION] WhatsApp sent to ${phone} via ${result.instanceId || 'unknown'}`);
    return true;
  } catch (error) {
    console.error('[NOTIFICATION] WhatsApp error:', error);
    return false;
  }
}

// Send email
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  if (!config.gmailUser || !config.gmailAppPassword) {
    console.log('[NOTIFICATION] Email not configured, skipping');
    return false;
  }

  try {
    await emailTransporter.sendMail({
      from: `"Hai.Tech" <${config.gmailUser}>`,
      to,
      subject,
      html,
    });

    console.log('[NOTIFICATION] Email sent to:', to);
    return true;
  } catch (error) {
    console.error('[NOTIFICATION] Email error:', error);
    return false;
  }
}

// Recipients for new-lead notifications
const ADMIN_PHONE = '0528746137'; // Ami's phone
const SALES_GROUP_CHAT_ID = '120363308669020817@g.us'; // Sales team WhatsApp group
const LEAD_ALERT_MAX_ATTEMPTS = Number(process.env.LEAD_ALERT_MAX_ATTEMPTS || 3);
const LEAD_ALERT_RETRY_DELAY_MS = Number(process.env.LEAD_ALERT_RETRY_DELAY_MS || 750);

type LeadAlertRecipientType = 'admin_private' | 'sales_group';

interface LeadAlertRecipient {
  type: LeadAlertRecipientType;
  label: string;
  chatId: string;
}

const INTERNAL_LEAD_ALERT_RECIPIENTS: LeadAlertRecipient[] = [
  { type: 'admin_private', label: 'Ami private', chatId: formatPhoneForWhatsApp(ADMIN_PHONE) },
  { type: 'sales_group', label: 'Sales group', chatId: SALES_GROUP_CHAT_ID },
];

function wait(ms: number): Promise<void> {
  if (process.env.NODE_ENV === 'test') return Promise.resolve();
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendGreenMessageWithRetry(
  recipient: LeadAlertRecipient,
  message: string,
): Promise<{ success: boolean; attempts: number; messageId?: string; error?: string }> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= LEAD_ALERT_MAX_ATTEMPTS; attempt += 1) {
    const result = await sendGreenApiMessage(recipient.chatId, message);
    if (result.success) {
      return { success: true, attempts: attempt, messageId: result.messageId };
    }

    lastError = result.error || 'Green API send failed';
    console.warn(`[LEAD-ALERT] ${recipient.label} attempt ${attempt}/${LEAD_ALERT_MAX_ATTEMPTS} failed: ${lastError}`);
    if (attempt < LEAD_ALERT_MAX_ATTEMPTS) {
      await wait(LEAD_ALERT_RETRY_DELAY_MS * attempt);
    }
  }

  return { success: false, attempts: LEAD_ALERT_MAX_ATTEMPTS, error: lastError };
}

async function sendTrackedLeadAlert(
  leadAppointmentId: string,
  recipient: LeadAlertRecipient,
  message: string,
): Promise<void> {
  const existing = await prisma.leadInternalAlertDelivery.findUnique({
    where: {
      leadAppointmentId_recipientType: {
        leadAppointmentId,
        recipientType: recipient.type,
      },
    },
  });

  if (existing?.status === 'sent') {
    console.log(`[LEAD-ALERT] ${recipient.label} already sent for lead ${leadAppointmentId}, skipping`);
    return;
  }

  await prisma.leadInternalAlertDelivery.upsert({
    where: {
      leadAppointmentId_recipientType: {
        leadAppointmentId,
        recipientType: recipient.type,
      },
    },
    create: {
      leadAppointmentId,
      recipientType: recipient.type,
      chatId: recipient.chatId,
      status: 'pending',
      attempts: existing?.attempts || 0,
    },
    update: {
      chatId: recipient.chatId,
      status: 'pending',
      lastError: null,
    },
  });

  const result = await sendGreenMessageWithRetry(recipient, message);
  const totalAttempts = (existing?.attempts || 0) + result.attempts;

  await prisma.leadInternalAlertDelivery.update({
    where: {
      leadAppointmentId_recipientType: {
        leadAppointmentId,
        recipientType: recipient.type,
      },
    },
    data: {
      status: result.success ? 'sent' : 'failed',
      attempts: totalAttempts,
      messageId: result.messageId || null,
      lastError: result.success ? null : (result.error || 'Green API send failed'),
      sentAt: result.success ? new Date() : null,
    },
  });

  if (!result.success) {
    console.error(`[LEAD-ALERT] ${recipient.label} failed for lead ${leadAppointmentId}: ${result.error}`);
  }
}

export async function sendTrackedInternalLeadAlerts(
  leadAppointmentId: string,
  message: string,
): Promise<void> {
  for (const recipient of INTERNAL_LEAD_ALERT_RECIPIENTS) {
    await sendTrackedLeadAlert(leadAppointmentId, recipient, message);
  }
}

async function sendUntrackedInternalLeadAlerts(message: string): Promise<void> {
  for (const recipient of INTERNAL_LEAD_ALERT_RECIPIENTS) {
    const result = await sendGreenMessageWithRetry(recipient, message);
    if (!result.success) {
      console.error(`[LEAD-ALERT] ${recipient.label} failed without leadAppointmentId: ${result.error}`);
    }
  }
}

// Notify admin about new lead
export async function notifyAdminNewLead(lead: {
  name: string;
  phone?: string | null;
  email?: string | null;
  childName?: string | null;
  interest?: string | null;
  source?: string;
  customerId?: string | null;
  leadAppointmentId?: string | null;
}): Promise<void> {
  const baseUrl = process.env.FRONTEND_URL || 'https://crm.orma-ai.com';
  const leadLink = lead.leadAppointmentId
    ? `${baseUrl}/lead-appointments?id=${lead.leadAppointmentId}`
    : `${baseUrl}/lead-appointments`;

  const message = `🎯 *ליד חדש מהאתר!*

👤 *שם:* ${lead.name}
📞 *טלפון:* ${lead.phone || 'לא צוין'}
📧 *מייל:* ${lead.email || 'לא צוין'}
${lead.childName ? `👧 *ילד/ה:* ${lead.childName}` : ''}
${lead.interest ? `🎓 *תחום עניין:* ${lead.interest}` : ''}
📍 *מקור:* ${lead.source || 'website'}

🔗 פתח ביומן הלידים: ${leadLink}`;

  if (lead.leadAppointmentId) {
    await sendTrackedInternalLeadAlerts(lead.leadAppointmentId, message);
    return;
  }

  await sendUntrackedInternalLeadAlerts(message);
}

// Welcome lead notification
export async function sendWelcomeNotifications(lead: {
  name: string;
  phone?: string | null;
  email?: string | null;
}): Promise<void> {
  const { name, email } = lead;

  // WhatsApp ללקוח נשלח דרך lead_welcome_hai template (ב-sendLeadWelcomeTemplate)
  // לא שולחים כאן הודעה חופשית ב-Green API

  // Send email if email provided
  if (email) {
    const emailHtml = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 0;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 40px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">
                🎯 Hai.Tech
              </h1>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">
                דרך ההייטק שלך
              </p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="color: #1f2937; margin: 0 0 20px; font-size: 24px;">
                שלום ${name}! 👋
              </h2>
              
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                תודה רבה שפנית אלינו!
              </p>
              
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                קיבלנו את פנייתך ונציג שלנו יחזור אליך בהקדם האפשרי.
              </p>
              
              <div style="background-color: #f0f9ff; border-radius: 12px; padding: 20px; margin: 30px 0;">
                <p style="color: #1e40af; font-size: 14px; margin: 0; font-weight: 500;">
                  💡 בינתיים, מוזמן/ת לבקר באתר שלנו ולהכיר את הקורסים וההדרכות שלנו
                </p>
              </div>
              
              <a href="https://hai.tech" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                לאתר Hai.Tech →
              </a>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px;">
                Hai.Tech - דרך ההייטק
              </p>
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                📧 info@hai.tech | 🌐 hai.tech
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

    await sendEmail(email, 'תודה שפנית אלינו! - Hai.Tech', emailHtml);
  }
}
