/**
 * Lead Welcome Template
 * Sends a WhatsApp welcome template to new leads.
 * Picks the template by `interest`:
 *   - "roblox-group-may26" → roblox_may26_match (campaign-specific, includes payment link)
 *   - everything else      → lead_welcome_hai (generic chatbot intro)
 * GATED by LEAD_WELCOME_WA_ENABLED=true env var (default: off).
 * Sends from the CRM-owned WhatsApp number by default, not the routed primary
 * bot number, so customer replies stay inside the CRM inbox.
 */
import axios from 'axios';
import { prisma } from '../utils/prisma.js';

type LeadWelcomeTemplate = {
  name: string;
  parameters: (firstName: string, interest?: string | null) => string[];
  preview: (firstName: string, interest?: string | null) => string;
};

// Maps a lead's `interest` to the right campaign-specific template.
// Add new campaigns here — generic `lead_welcome_hai` stays the fallback.
const CAMPAIGN_TEMPLATES: Record<string, LeadWelcomeTemplate> = {
  'roblox-group-may26': {
    name: 'roblox_may26_match',
    parameters: (firstName) => [firstName],
    preview: (firstName) => `[תבנית: roblox_may26_match] התאמה מצוינת! 🎯 ${firstName}, פרטי הקורס + לינק לתשלום`,
  },
};

const DEFAULT_CRM_BUSINESS_PHONE = '+972533009742';

function resolveLeadWelcomePhone() {
  const phoneNumberId =
    process.env.LEAD_WELCOME_WA_PHONE_NUMBER_ID ||
    process.env.WA_PHONE_NUMBER_ID_2 ||
    process.env.WA_PHONE_NUMBER_ID ||
    '';

  const businessPhone =
    process.env.LEAD_WELCOME_WA_BUSINESS_PHONE ||
    (phoneNumberId === process.env.WA_PHONE_NUMBER_ID_2 ? DEFAULT_CRM_BUSINESS_PHONE : '+972533027763');

  return { phoneNumberId, businessPhone };
}

function selectLeadWelcomeTemplate(interest?: string | null): LeadWelcomeTemplate {
  const exact = interest ? CAMPAIGN_TEMPLATES[interest] : null;
  if (exact) return exact;

  const normalizedInterest = (interest || '').toLowerCase();
  if (/(trial|campaign|התנסות|ניסיון|נסיון|קמפיין)/.test(normalizedInterest)) {
    return {
      name: process.env.LEAD_WELCOME_TRIAL_TEMPLATE_NAME || 'lead_welcome_trial_or_campaign',
      parameters: (name, value) => [name, value || 'הקורס'],
      preview: (name, value) => `[תבנית: lead_welcome_trial_or_campaign] היי ${name}, תודה שהתעניינת ב-${value || 'הקורס'}.`,
    };
  }

  if (interest) {
    return {
      name: process.env.LEAD_WELCOME_INTEREST_TEMPLATE_NAME || 'lead_welcome_course_interest',
      parameters: (name) => [name],
      preview: (name) => `[תבנית: lead_welcome_course_interest] היי ${name}, קיבלנו את ההתעניינות שלך בדרך ההייטק.`,
    };
  }

  return {
    name: process.env.LEAD_WELCOME_DEFAULT_TEMPLATE_NAME || 'lead_welcome_hai',
    parameters: (name) => [name],
    preview: (name) => `[תבנית: lead_welcome_hai] היי ${name} 👋 קיבלנו את ההתעניינות שלך!`,
  };
}

export async function sendLeadWelcomeTemplate(phone: string, name: string, interest?: string | null): Promise<void> {
  if (process.env.LEAD_WELCOME_WA_ENABLED !== 'true') return;
  if (!phone) return;

  try {
    const normalizedPhone = phone.replace(/\D/g, '').replace(/^0/, '972');
    const { phoneNumberId: waPhoneId, businessPhone } = resolveLeadWelcomePhone();
    const waToken = process.env.WA_ACCESS_TOKEN || '';
    const firstName = name?.split(' ')[0] || name || 'שלום';

    const template = selectLeadWelcomeTemplate(interest);

    // Ensure the message is tracked under the same CRM-owned business number
    // customers will reply to.
    let conv = waPhoneId
      ? await prisma.waConversation.findFirst({ where: { phone: normalizedPhone, phoneNumberId: waPhoneId } })
      : await prisma.waConversation.findFirst({ where: { phone: normalizedPhone } });
    if (!conv) {
      conv = await prisma.waConversation.create({
        data: {
          phone: normalizedPhone,
          contactName: name || normalizedPhone,
          phoneNumberId: waPhoneId,
          businessPhone,
        },
      });
    } else if (waPhoneId && (conv.businessPhone !== businessPhone || conv.phoneNumberId !== waPhoneId)) {
      conv = await prisma.waConversation.update({
        where: { id: conv.id },
        data: { phoneNumberId: waPhoneId, businessPhone },
      });
    }

    // Send template via Meta Cloud API
    const resp = await axios.post(
      `https://graph.facebook.com/v20.0/${waPhoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: normalizedPhone,
        type: 'template',
        template: {
          name: template.name,
          language: { code: 'he' },
          components: [{
            type: 'body',
            parameters: template.parameters(firstName, interest).map(text => ({ type: 'text', text })),
          }],
        },
      },
      { headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' } }
    );

    const waId = resp.data?.messages?.[0]?.id;
    const messageContent = template.preview(firstName, interest);
    const now = new Date();

    await prisma.waMessage.create({
      data: {
        conversationId: conv.id,
        direction: 'outbound',
        content: messageContent,
        waMessageId: waId || undefined,
        status: 'sent',
        isAiGenerated: false,
      },
    });

    // Update conversation so the message shows in CRM UI
    await prisma.waConversation.update({
      where: { id: conv.id },
      data: {
        lastMessageAt: now,
        lastMessagePreview: messageContent.slice(0, 200),
      },
    });

    console.log(`[LeadWelcome] Template '${template.name}' sent to ${normalizedPhone} via ${waPhoneId}`);
  } catch (err: any) {
    console.error('[LeadWelcome] Failed to send template:', err.response?.data || err.message);
  }
}
