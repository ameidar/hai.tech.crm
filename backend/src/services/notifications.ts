import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { sendGreenApiMessage } from './green-api-client.js';
import {
  sendWhatsAppCloudTemplate,
  templateText,
} from './whatsapp-cloud-templates.js';

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
const KIM_PHONE = '0543354550'; // Kim's phone
const SALES_GROUP_CHAT_ID = '120363308669020817@g.us'; // Sales team WhatsApp group
const DEFAULT_LEAD_ADMIN_TEMPLATE = 'lead_admin_new_lead';
const DEFAULT_LEAD_ADMIN_TEMPLATE_RECIPIENTS = `${ADMIN_PHONE},${KIM_PHONE}`;

type LeadAdminNotification = {
  name: string;
  phone?: string | null;
  email?: string | null;
  childName?: string | null;
  interest?: string | null;
  source?: string;
  customerId?: string | null;
  leadAppointmentId?: string | null;
};

function leadAdminTemplateRecipients(): string[] {
  const raw = process.env.LEAD_ADMIN_WA_TEMPLATE_RECIPIENTS || DEFAULT_LEAD_ADMIN_TEMPLATE_RECIPIENTS;
  return raw
    .split(',')
    .map(phone => phone.trim())
    .filter(Boolean);
}

export function buildLeadAdminTemplateVariables(lead: LeadAdminNotification, leadLink: string): string[] {
  return [
    templateText(lead.name, 'לא צוין'),
    templateText(lead.phone, 'לא צוין'),
    templateText(lead.email, 'לא צוין'),
    templateText(lead.childName, 'לא צוין'),
    templateText(lead.interest, 'לא צוין'),
    templateText(lead.source, 'website'),
    templateText(leadLink, 'https://crm.orma-ai.com/lead-appointments'),
  ];
}

export function buildLeadAdminTemplatePreview(lead: LeadAdminNotification, leadLink: string): string {
  return [
    `[תבנית: ${process.env.LEAD_ADMIN_WA_TEMPLATE_NAME || DEFAULT_LEAD_ADMIN_TEMPLATE}] ליד חדש נכנס ל-CRM`,
    `שם: ${lead.name || 'לא צוין'}`,
    `טלפון: ${lead.phone || 'לא צוין'}`,
    `מייל: ${lead.email || 'לא צוין'}`,
    `ילד/ה: ${lead.childName || 'לא צוין'}`,
    `תחום עניין: ${lead.interest || 'לא צוין'}`,
    `מקור: ${lead.source || 'website'}`,
    `לינק: ${leadLink}`,
  ].join('\n');
}

async function sendLeadAdminTemplateNotifications(lead: LeadAdminNotification, leadLink: string): Promise<void> {
  if (process.env.LEAD_ADMIN_WA_TEMPLATE_ENABLED !== 'true') return;

  const templateName = process.env.LEAD_ADMIN_WA_TEMPLATE_NAME || DEFAULT_LEAD_ADMIN_TEMPLATE;
  const recipients = leadAdminTemplateRecipients();
  if (recipients.length === 0) {
    console.warn('[NOTIFICATION] Lead admin WhatsApp template enabled but no recipients configured');
    return;
  }

  const bodyParameters = buildLeadAdminTemplateVariables(lead, leadLink);
  const preview = buildLeadAdminTemplatePreview(lead, leadLink);

  await Promise.all(recipients.map(async (phone) => {
    const result = await sendWhatsAppCloudTemplate({
      phone,
      contactName: phone === ADMIN_PHONE ? 'עמי מידר' : phone === KIM_PHONE ? 'קים נווה' : undefined,
      templateName,
      bodyParameters,
      preview,
      phoneNumberId: process.env.LEAD_ADMIN_WA_PHONE_NUMBER_ID || process.env.WA_REMINDER_PHONE_NUMBER_ID || process.env.WA_PHONE_NUMBER_ID,
      businessPhone: process.env.LEAD_ADMIN_WA_BUSINESS_PHONE || process.env.WA_REMINDER_BUSINESS_PHONE,
    });

    if (!result.success) {
      console.error(`[NOTIFICATION] Lead admin WhatsApp template failed for ${phone}:`, result.error);
    }
  }));
}

// Notify admin about new lead
export async function notifyAdminNewLead(lead: LeadAdminNotification): Promise<void> {
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

  const tasks: Promise<unknown>[] = [
    sendLeadAdminTemplateNotifications(lead, leadLink),
  ];

  if (process.env.LEAD_ADMIN_GREEN_FALLBACK_ENABLED !== 'false') {
    tasks.push(
      sendWhatsAppMessage(ADMIN_PHONE, message),
      sendWhatsAppMessage(KIM_PHONE, message),
      sendWhatsAppMessage(SALES_GROUP_CHAT_ID, message),
    );
  }

  await Promise.all(tasks);
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
