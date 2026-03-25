/**
 * Lead Welcome Template
 * Sends 'lead_welcome_hai' WhatsApp template to new leads.
 * GATED by LEAD_WELCOME_WA_ENABLED=true env var (default: off).
 */
import axios from 'axios';
import { prisma } from '../utils/prisma.js';

export async function sendLeadWelcomeTemplate(phone: string, name: string): Promise<void> {
  if (process.env.LEAD_WELCOME_WA_ENABLED !== 'true') return;
  if (!phone) return;

  try {
    const normalizedPhone = phone.replace(/\D/g, '').replace(/^0/, '972');
    const waPhoneId = process.env.WA_PHONE_NUMBER_ID || '';
    const waToken = process.env.WA_ACCESS_TOKEN || '';
    const firstName = name?.split(' ')[0] || name || 'שלום';

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
          name: 'lead_welcome_hai',
          language: { code: 'he' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }],
        },
      },
      { headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' } }
    );

    const waId = resp.data?.messages?.[0]?.id;
    await prisma.waMessage.create({
      data: {
        conversationId: conv.id,
        direction: 'outbound',
        content: `[תבנית: lead_welcome_hai] היי ${firstName} 👋 קיבלנו את ההתעניינות שלך!`,
        waMessageId: waId || undefined,
        status: 'sent',
        isAiGenerated: false,
      },
    });

    console.log(`[LeadWelcome] Template sent to ${normalizedPhone}`);
  } catch (err: any) {
    console.error('[LeadWelcome] Failed to send template:', err.response?.data || err.message);
  }
}
