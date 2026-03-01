import { prisma } from '../utils/prisma.js';
import { sendEmail } from './email/sender.js';
import axios from 'axios';

const BASE_URL = process.env.BASE_URL || 'https://crm.orma-ai.com';

/**
 * Build a UTM tracking URL for a specific recipient
 */
export function buildTrackingUrl(campaignId: string, recipientId: string, targetUrl: string): string {
  return `${BASE_URL}/api/campaigns/click?cid=${encodeURIComponent(campaignId)}&rid=${encodeURIComponent(recipientId)}&url=${encodeURIComponent(targetUrl)}`;
}

export interface AudienceFilters {
  courseIds?: string[];
  branchIds?: string[];
  ageMin?: number;
  ageMax?: number;
  cycleStatus?: 'active' | 'completed' | 'all';
}

export interface RecipientInfo {
  customerId: string;
  customerName: string;
  phone?: string;
  email?: string;
  studentName?: string;
}

export interface AudienceResult {
  count: number;
  sample: RecipientInfo[];
  recipients: RecipientInfo[];
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function resolveAudience(filters: AudienceFilters): Promise<AudienceResult> {
  const { courseIds, branchIds, ageMin, ageMax, cycleStatus = 'all' } = filters;

  // Build cycle where clause
  const cycleWhere: Record<string, unknown> = {};
  if (courseIds && courseIds.length > 0) {
    cycleWhere.courseId = { in: courseIds };
  }
  if (branchIds && branchIds.length > 0) {
    cycleWhere.branchId = { in: branchIds };
  }
  if (cycleStatus === 'active') {
    cycleWhere.status = 'active';
  } else if (cycleStatus === 'completed') {
    cycleWhere.status = 'completed';
  }
  // 'all' = no status filter

  // Build student where clause for age
  const studentWhere: Record<string, unknown> = {};
  const now = new Date();
  if (ageMin !== undefined || ageMax !== undefined) {
    const birthDateFilter: Record<string, Date> = {};
    if (ageMax !== undefined) {
      // born after (now - ageMax - 1 years) → youngest cutoff
      const minBirth = new Date(now);
      minBirth.setFullYear(minBirth.getFullYear() - ageMax - 1);
      birthDateFilter.gte = minBirth;
    }
    if (ageMin !== undefined) {
      // born before (now - ageMin years) → oldest cutoff
      const maxBirth = new Date(now);
      maxBirth.setFullYear(maxBirth.getFullYear() - ageMin);
      birthDateFilter.lte = maxBirth;
    }
    studentWhere.birthDate = birthDateFilter;
  }

  // Query registrations with all the filters
  const registrations = await prisma.registration.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['cancelled'] },
      cycle: {
        deletedAt: null,
        ...cycleWhere,
      },
      student: {
        deletedAt: null,
        ...studentWhere,
        customer: { deletedAt: null },
      },
    },
    include: {
      student: {
        include: {
          customer: true,
        },
      },
    },
  });

  // Deduplicate by customerId
  const seen = new Set<string>();
  const recipients: RecipientInfo[] = [];

  for (const reg of registrations) {
    const customerId = reg.student.customerId;
    if (seen.has(customerId)) continue;
    seen.add(customerId);

    const customer = reg.student.customer;
    recipients.push({
      customerId,
      customerName: customer.name,
      phone: customer.phone || undefined,
      email: customer.email || undefined,
      studentName: reg.student.name,
    });
  }

  return {
    count: recipients.length,
    sample: recipients.slice(0, 10),
    recipients,
  };
}

export async function sendCampaign(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { recipients: true },
  });

  // Mark as started
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'sending', startedAt: new Date() },
  });

  const channel = campaign.channel; // 'email', 'whatsapp', 'both'
  const waToken = process.env.WA_CLOUD_TOKEN;
  const waPhoneId = process.env.WA_CLOUD_PHONE_NUMBER_ID;

  // Landing URL for UTM tracking (fallback to the public campaign landing page)
  const landingUrl = (campaign as { landingUrl?: string }).landingUrl ||
    `${BASE_URL}/campaign/${campaign.id}`;

  let deliveredCount = 0;
  let failedCount = 0;

  for (const recipient of campaign.recipients) {
    if (recipient.status !== 'pending') continue;

    let recipientError: string | undefined;
    let sent = false;

    // Build per-recipient tracking URL and replace {utm_link} placeholder
    const trackingUrl = buildTrackingUrl(campaign.id, recipient.id, landingUrl);
    const resolvedHtml = campaign.contentHtml?.replace(/\{utm_link\}/g, trackingUrl) ?? '';
    const resolvedWa = campaign.contentWa?.replace(/\{utm_link\}/g, trackingUrl) ?? '';

    const shouldSendEmail = (channel === 'email' || channel === 'both') && recipient.email;
    const shouldSendWa = (channel === 'whatsapp' || channel === 'both') && recipient.phone;

    // Send email
    if (shouldSendEmail && campaign.subject && resolvedHtml) {
      try {
        const result = await sendEmail({
          to: recipient.email!,
          subject: campaign.subject,
          html: resolvedHtml,
        });
        if (result.success) {
          sent = true;
        } else {
          recipientError = result.error;
        }
        await sleep(100);
      } catch (err) {
        recipientError = String(err);
      }
    }

    // Send WhatsApp
    if (shouldSendWa && resolvedWa) {
      try {
        const phone = recipient.phone!.replace(/\D/g, '');
        const resp = await axios.post(
          `https://graph.facebook.com/v18.0/${waPhoneId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: phone,
            type: 'text',
            text: { body: resolvedWa },
          },
          {
            headers: {
              Authorization: `Bearer ${waToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
        if (resp.status === 200) {
          sent = true;
        }
        await sleep(200);
      } catch (err: unknown) {
        const axErr = err as { response?: { data?: unknown }; message?: string };
        recipientError = JSON.stringify(axErr.response?.data || axErr.message);
      }
    }

    // Update recipient status
    if (sent) {
      deliveredCount++;
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'sent', sentAt: new Date() },
      });
    } else {
      failedCount++;
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'failed', error: recipientError },
      });
    }
  }

  // Mark campaign as completed
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: 'completed',
      completedAt: new Date(),
      deliveredCount,
      failedCount,
    },
  });
}
