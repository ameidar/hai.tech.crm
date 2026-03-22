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

export interface FileRecipient {
  name?: string;
  phone?: string;
  email?: string;
}

export interface AudienceFilters {
  cycleIds?: string[];
  courseIds?: string[];
  branchIds?: string[];
  ageMin?: number;
  ageMax?: number;
  cycleStatus?: 'active' | 'completed' | 'all';
  registrationStatus?: 'all' | 'registered' | 'not_registered';
  hasEmail?: boolean;
  hasPhone?: boolean;
  fileRecipients?: FileRecipient[];
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
  const {
    cycleIds, courseIds, branchIds, ageMin, ageMax,
    cycleStatus = 'all',
    registrationStatus = 'all',
    hasEmail, hasPhone,
    fileRecipients,
  } = filters;

  // ── File upload mode: match by phone/email against DB ────────────────────
  if (fileRecipients && fileRecipients.length > 0) {
    const phones = fileRecipients.map(r => r.phone).filter(Boolean) as string[];
    const emails = fileRecipients.map(r => r.email).filter(Boolean) as string[];

    // Find matching customers in DB
    const matched = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [
          ...(phones.length ? [{ phone: { in: phones } }] : []),
          ...(emails.length ? [{ email: { in: emails } }] : []),
        ],
      },
      select: { id: true, name: true, phone: true, email: true },
    });
    const matchedByPhone = new Map(matched.map(c => [c.phone, c]));
    const matchedByEmail = new Map(matched.map(c => [c.email, c]));

    const seenIds = new Set<string>();
    const recipients: RecipientInfo[] = [];

    for (const fr of fileRecipients) {
      const dbCustomer = (fr.phone && matchedByPhone.get(fr.phone)) ||
                         (fr.email && matchedByEmail.get(fr.email));
      if (dbCustomer) {
        if (seenIds.has(dbCustomer.id)) continue;
        seenIds.add(dbCustomer.id);
        recipients.push({
          customerId: dbCustomer.id,
          customerName: dbCustomer.name,
          phone: dbCustomer.phone || undefined,
          email: dbCustomer.email || undefined,
        });
      } else {
        // Not in DB — use file data directly (anonymous)
        const anonId = `file:${fr.phone || fr.email}`;
        if (seenIds.has(anonId)) continue;
        seenIds.add(anonId);
        recipients.push({
          customerId: anonId,
          customerName: fr.name || fr.phone || fr.email || 'לא ידוע',
          phone: fr.phone || undefined,
          email: fr.email || undefined,
        });
      }
    }

    return { count: recipients.length, sample: recipients.slice(0, 10), recipients };
  }

  const hasCycleFilters =
    (cycleIds && cycleIds.length > 0) ||
    (courseIds && courseIds.length > 0) ||
    (branchIds && branchIds.length > 0) ||
    ageMin !== undefined ||
    ageMax !== undefined ||
    (cycleStatus && cycleStatus !== 'all');

  const hasContactFilters = hasEmail !== undefined || hasPhone !== undefined;

  // ── "not_registered": customers with NO active registrations ─────────────
  if (registrationStatus === 'not_registered') {
    // Get all customer IDs that have at least one active registration
    const activeRegs = await prisma.registration.findMany({
      where: { deletedAt: null, status: { notIn: ['cancelled'] } },
      select: { student: { select: { customerId: true } } },
    });
    const registeredIds = new Set(activeRegs.map(r => r.student.customerId));

    const customerWhere: Record<string, unknown> = { deletedAt: null, emailUnsubscribed: false };
    if (hasEmail) customerWhere.email = { not: null };
    if (hasPhone) customerWhere.phone = { not: null };

    const customers = await prisma.customer.findMany({
      where: customerWhere,
      select: { id: true, name: true, phone: true, email: true },
    });

    const recipients: RecipientInfo[] = customers
      .filter(c => !registeredIds.has(c.id))
      .map(c => ({
        customerId: c.id,
        customerName: c.name,
        phone: c.phone || undefined,
        email: c.email || undefined,
      }));

    return { count: recipients.length, sample: recipients.slice(0, 10), recipients };
  }

  // ── No cycle/contact filters + registered=all: all customers ─────────────
  if (!hasCycleFilters && !hasContactFilters && registrationStatus === 'all') {
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null, emailUnsubscribed: false },
      select: { id: true, name: true, phone: true, email: true },
    });

    const recipients: RecipientInfo[] = customers.map(c => ({
      customerId: c.id,
      customerName: c.name,
      phone: c.phone || undefined,
      email: c.email || undefined,
    }));

    return { count: recipients.length, sample: recipients.slice(0, 10), recipients };
  }

  // ── With cycle/contact filters: go through registrations ──────────────────

  // Build cycle where clause
  const cycleWhere: Record<string, unknown> = {};
  if (cycleIds && cycleIds.length > 0) {
    cycleWhere.id = { in: cycleIds };
  } else {
    if (courseIds && courseIds.length > 0) cycleWhere.courseId = { in: courseIds };
    if (branchIds && branchIds.length > 0) cycleWhere.branchId = { in: branchIds };
    if (cycleStatus === 'active') cycleWhere.status = 'active';
    else if (cycleStatus === 'completed') cycleWhere.status = 'completed';
  }

  // Build student/age where clause
  const studentWhere: Record<string, unknown> = {};
  const now = new Date();
  if (ageMin !== undefined || ageMax !== undefined) {
    const birthDateFilter: Record<string, Date> = {};
    if (ageMax !== undefined) {
      const minBirth = new Date(now);
      minBirth.setFullYear(minBirth.getFullYear() - ageMax - 1);
      birthDateFilter.gte = minBirth;
    }
    if (ageMin !== undefined) {
      const maxBirth = new Date(now);
      maxBirth.setFullYear(maxBirth.getFullYear() - ageMin);
      birthDateFilter.lte = maxBirth;
    }
    studentWhere.birthDate = birthDateFilter;
  }

  // Customer contact filter (always exclude unsubscribed)
  const customerWhere: Record<string, unknown> = { deletedAt: null, emailUnsubscribed: false };
  if (hasEmail) customerWhere.email = { not: null };
  if (hasPhone) customerWhere.phone = { not: null };

  const registrations = await prisma.registration.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['cancelled'] },
      cycle: { deletedAt: null, ...cycleWhere },
      student: {
        deletedAt: null,
        ...studentWhere,
        customer: customerWhere,
      },
    },
    include: { student: { include: { customer: true } } },
  });

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

  // If registrationStatus = 'registered', we already filtered by registrations
  return { count: recipients.length, sample: recipients.slice(0, 10), recipients };
}

export async function sendCampaign(campaignId: string, dailyLimit?: number): Promise<void> {
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: {
      recipients: {
        where: { status: 'pending' },
        include: { customer: { select: { name: true } } },
        ...(dailyLimit ? { take: dailyLimit } : {}),
      },
    },
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

    // Build per-recipient tracking URL and replace all placeholders
    const trackingUrl = buildTrackingUrl(campaign.id, recipient.id, landingUrl);
    const recipientName = (recipient as { customer?: { name?: string }; recipientName?: string }).customer?.name
      || (recipient as { recipientName?: string }).recipientName
      || '';
    const resolvedHtml = (campaign.contentHtml ?? '')
      .replace(/\{utm_link\}/g, trackingUrl)
      .replace(/\{שם_הורה\}/g, recipientName)
      .replace(/\{שם_ילד\}/g, recipientName);
    const resolvedWa = (campaign.contentWa ?? '')
      .replace(/\{utm_link\}/g, trackingUrl)
      .replace(/\{שם_הורה\}/g, recipientName)
      .replace(/\{שם_ילד\}/g, recipientName);

    const shouldSendEmail = (channel === 'email' || channel === 'both') && recipient.email;
    const shouldSendWa = (channel === 'whatsapp' || channel === 'both') && recipient.phone;

    // Build unsubscribe URL
    const unsubscribeUrl = `${BASE_URL}/api/campaigns/unsubscribe?rid=${encodeURIComponent(recipient.id)}`;

    // Inject open-tracking pixel into email HTML
    const openPixelUrl = `${BASE_URL}/api/campaigns/track/open/${encodeURIComponent(campaign.id)}/${encodeURIComponent(recipient.id)}`;
    const openPixel = `<img src="${openPixelUrl}" width="1" height="1" style="display:none;border:0;outline:0;" alt="" />`;

    // Build unsubscribe footer
    const unsubscribeFooter = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#9ca3af;">
  קיבלת מייל זה כי אתה נמצא ברשימת התפוצה של דרך ההייטק.<br>
  <a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">הסר אותי מרשימת התפוצה</a>
</div>`;

    const htmlWithExtras = resolvedHtml
      ? resolvedHtml.includes('</body>')
        ? resolvedHtml.replace(/<\/body>/i, `${unsubscribeFooter}${openPixel}</body>`)
        : resolvedHtml + unsubscribeFooter + openPixel
      : resolvedHtml;

    // Send email
    if (shouldSendEmail && campaign.subject && htmlWithExtras) {
      try {
        const result = await sendEmail({
          to: recipient.email!,
          subject: (campaign.subject || '').replace(/\{שם_הורה\}/g, recipientName).replace(/\{שם_ילד\}/g, recipientName),
          html: htmlWithExtras,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
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
