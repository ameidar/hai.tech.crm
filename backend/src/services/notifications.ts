import nodemailer from 'nodemailer';
import { config } from '../config.js';

// Gmail SMTP transporter
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.gmailUser,
    pass: config.gmailAppPassword,
  },
});

// WhatsApp via Green API
const greenApiBaseUrl = `https://api.green-api.com/waInstance${config.greenApiInstanceId}`;

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
  if (!config.greenApiInstanceId || !config.greenApiToken) {
    console.log('[NOTIFICATION] WhatsApp not configured, skipping');
    return false;
  }

  try {
    const chatId = formatPhoneForWhatsApp(phone);
    const response = await fetch(
      `${greenApiBaseUrl}/sendMessage/${config.greenApiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message }),
      }
    );

    if (!response.ok) {
      console.error('[NOTIFICATION] WhatsApp send failed:', await response.text());
      return false;
    }

    console.log('[NOTIFICATION] WhatsApp sent to:', phone);
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

// Notify admin about new lead
export async function notifyAdminNewLead(lead: {
  name: string;
  phone?: string | null;
  email?: string | null;
  childName?: string | null;
  interest?: string | null;
  source?: string;
}): Promise<void> {
  const adminPhone = '0528746137'; // Ami's phone
  
  const message = `🎯 *ליד חדש מהאתר!*

👤 *שם:* ${lead.name}
📞 *טלפון:* ${lead.phone || 'לא צוין'}
📧 *מייל:* ${lead.email || 'לא צוין'}
${lead.childName ? `👧 *ילד/ה:* ${lead.childName}` : ''}
${lead.interest ? `🎓 *תחום עניין:* ${lead.interest}` : ''}
📍 *מקור:* ${lead.source || 'website'}

🔗 ${process.env.FRONTEND_URL || 'https://crm.orma-ai.com'}/customers`;

  await sendWhatsAppMessage(adminPhone, message);
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
