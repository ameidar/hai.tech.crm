/**
 * Lead Welcome Template
 * Sends a WhatsApp welcome template to new leads.
 * Picks the template by `interest`:
 *   - "roblox-group-may26" → roblox_may26_match (campaign-specific, includes payment link)
 *   - everything else      → lead_welcome_hai (generic chatbot intro)
 * GATED by LEAD_WELCOME_WA_ENABLED=true env var (default: off).
 */
import axios from 'axios';
import { prisma } from '../utils/prisma.js';

// Maps a lead's `interest` to the right campaign-specific template.
// Add new campaigns here — generic `lead_welcome_hai` stays the default.
const CAMPAIGN_TEMPLATES: Record<string, { name: string; preview: (firstName: string) => string }> = {
  'roblox-group-may26': {
    name: 'roblox_may26_match',
    preview: (firstName) => `[תבנית: roblox_may26_match] התאמה מצוינת! 🎯 ${firstName}, פרטי הקורס + לינק לתשלום`,
  },
};

export async function sendLeadWelcomeTemplate(phone: string, name: string, interest?: string | null): Promise<void> {
  if (process.env.LEAD_WELCOME_WA_ENABLED !== 'true') return;
  if (!phone) return;

  try {
    const normalizedPhone = phone.replace(/\D/g, '').replace(/^0/, '972');
    const waPhoneId = process.env.WA_PHONE_NUMBER_ID || '';
    const waToken = process.env.WA_ACCESS_TOKEN || '';
    const firstName = name?.split(' ')[0] || name || 'שלום';

    const campaign = (interest && CAMPAIGN_TEMPLATES[interest]) || null;
    const templateName = campaign ? campaign.name : 'lead_welcome_hai';

    // Ensure conversation record exists
    let conv = await prisma.waConversation.findFirst({ where: { phone: normalizedPhone } });
    if (!conv) {
      conv = await prisma.waConversation.create({
        data: {
          phone: normalizedPhone,
          contactName: name || normalizedPhone,
          phoneNumberId: waPhoneId,
          businessPhone: '+972533027763',
        },
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
          name: templateName,
          language: { code: 'he' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }],
        },
      },
      { headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' } }
    );

    const waId = resp.data?.messages?.[0]?.id;
    const messageContent = campaign
      ? campaign.preview(firstName)
      : `[תבנית: lead_welcome_hai] היי ${firstName} 👋 קיבלנו את ההתעניינות שלך!`;
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

    console.log(`[LeadWelcome] Template '${templateName}' sent to ${normalizedPhone}`);
  } catch (err: any) {
    console.error('[LeadWelcome] Failed to send template:', err.response?.data || err.message);
  }
}
