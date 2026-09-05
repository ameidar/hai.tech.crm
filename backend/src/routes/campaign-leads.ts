import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { findOrCreateCustomer } from '../utils/lead-customer.js';
import { sendLeadWelcomeTemplate } from '../services/lead-welcome.js';
import { findOrCreateLeadAppointment } from '../utils/lead-dedup.js';
import { autoRegisterLeadToCycle } from '../services/lead-cycle-registration.js';
import { createWooPaymentLink } from '../services/woo-payment-link.js';

export const campaignLeadsRouter = Router();

interface CampaignChildInput {
  childName?: string;
  childAge?: string;
  grade?: string;
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeChildren(body: {
  children?: unknown;
  childName?: string;
  childAge?: string;
  grade?: string;
}): CampaignChildInput[] {
  if (Array.isArray(body.children)) {
    return body.children
      .flatMap((child) => {
        if (!child || typeof child !== 'object') return [];
        const item = child as CampaignChildInput;
        const normalized = {
          childName: cleanText(item.childName),
          childAge: cleanText(item.childAge),
          grade: cleanText(item.grade),
        };
        return normalized.childName ? [normalized] : [];
      })
  }

  const childName = cleanText(body.childName);
  return childName ? [{
    childName,
    childAge: cleanText(body.childAge),
    grade: cleanText(body.grade),
  }] : [];
}

function getCampaignCycleId(audienceFilters: unknown): string | null {
  if (!audienceFilters || typeof audienceFilters !== 'object' || Array.isArray(audienceFilters)) {
    return null;
  }

  const value = (audienceFilters as { cycleId?: unknown }).cycleId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getCampaignMaxInstallments(audienceFilters: unknown): number {
  if (!audienceFilters || typeof audienceFilters !== 'object' || Array.isArray(audienceFilters)) {
    return 0;
  }

  const value = (audienceFilters as { maxInstallments?: unknown; maxPayments?: unknown }).maxInstallments
    ?? (audienceFilters as { maxPayments?: unknown }).maxPayments;
  const num = Number(value);
  return Number.isInteger(num) && num > 1 && num <= 36 ? num : 0;
}

function publicOrigin(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) || req.protocol;
  return `${proto}://${req.get('host')}`;
}

function publicPaymentUrl(req: Request, code?: string | null): string | null {
  return code ? `${publicOrigin(req)}/pl/${code}` : null;
}

async function findCyclePaymentLink(cycleId: string) {
  return prisma.paymentLink.findFirst({
    where: {
      description: { contains: `[cycle:${cycleId}]` },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      code: true,
      amount: true,
      maxPayments: true,
    },
  });
}

/**
 * GET /api/campaign-leads/:campaignId
 * Public endpoint — no auth required.
 * Returns campaign landing metadata, including linked cycle details when present.
 */
campaignLeadsRouter.get('/:campaignId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaignId = String(req.params.campaignId || '').trim();
    if (!campaignId) {
      res.status(400).json({ error: 'campaignId is required' });
      return;
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        name: true,
        description: true,
        audienceFilters: true,
      },
    });

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const cycleId = getCampaignCycleId(campaign.audienceFilters);
    const cycle = cycleId
      ? await prisma.cycle.findFirst({
        where: { id: cycleId, deletedAt: null },
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          startTime: true,
          endTime: true,
          durationMinutes: true,
          totalMeetings: true,
          defaultRegistrationAmount: true,
          minimumStudentsThreshold: true,
          isOnline: true,
          videoProvider: true,
          zoomJoinUrl: true,
          course: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          instructor: { select: { id: true, name: true } },
        },
      })
      : null;

    const paymentLink = cycleId ? await findCyclePaymentLink(cycleId) : null;

    res.json({
      success: true,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        cycleId,
      },
      cycle: cycle ? {
        id: cycle.id,
        name: cycle.name,
        courseName: cycle.course.name,
        branchName: cycle.branch.name,
        instructorName: cycle.instructor.name,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        startTime: cycle.startTime,
        endTime: cycle.endTime,
        durationMinutes: cycle.durationMinutes,
        totalMeetings: cycle.totalMeetings,
        defaultRegistrationAmount: cycle.defaultRegistrationAmount,
        minimumStudentsThreshold: cycle.minimumStudentsThreshold,
        isOnline: cycle.isOnline,
        videoProvider: cycle.videoProvider,
        meetingUrl: cycle.zoomJoinUrl,
      } : null,
      payment: paymentLink ? {
        url: publicPaymentUrl(req, paymentLink.code),
        amount: paymentLink.amount,
        maxPayments: paymentLink.maxPayments,
      } : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/campaign-leads
 * Public endpoint — no auth required.
 * Creates a lead from a campaign landing page form submission.
 */
campaignLeadsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { campaignId, name, phone, email, interest } = req.body as {
      campaignId?: string;
      name?: string;
      phone?: string;
      email?: string;
      interest?: string;
      childName?: string;
      childAge?: string;
      grade?: string;
      children?: unknown;
    };
    const children = normalizeChildren(req.body);
    const primaryChild = children[0] ?? {};

    if (!name || !phone) {
      res.status(400).json({ error: 'שם וטלפון הם שדות חובה' });
      return;
    }

    const campaign = campaignId
      ? await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, name: true, audienceFilters: true },
      })
      : null;
    const cycleId = campaign ? getCampaignCycleId(campaign.audienceFilters) : null;
    const configuredMaxInstallments = campaign ? getCampaignMaxInstallments(campaign.audienceFilters) : 0;

    if (cycleId && children.length === 0) {
      res.status(400).json({ error: 'שם הילד הוא שדה חובה להרשמה למחזור, ואפשר להוסיף כמה ילדים' });
      return;
    }

    const leadSource = campaignId ? `campaign:${campaignId}` : 'campaign';
    const leadNotes = [
      cycleId ? `הרשמה למחזור: ${cycleId}` : null,
      interest ? `תחום עניין: ${interest}` : null,
      children.length > 0 ? `ילדים: ${children.map(child => [
        child.childName,
        child.childAge ? `גיל ${child.childAge}` : null,
        child.grade ? `כיתה ${child.grade}` : null,
      ].filter(Boolean).join(' / ')).join('; ')}` : null,
    ].filter(Boolean).join(' | ') || 'ליד מקמפיין';

    // Find or create customer + add to communication history
    const { customerId, isNew } = await findOrCreateCustomer({
      name,
      phone,
      email,
      source: leadSource,
      notes: leadNotes,
      childName: primaryChild.childName,
      childAge: primaryChild.childAge,
    });

    // Create or merge LeadAppointment (dedup by phone)
    const { lead, isDuplicate } = await findOrCreateLeadAppointment({
      customerId: customerId ?? null,
      customerName: name,
      customerPhone: phone,
      customerEmail: email,
      childName: children.map(child => child.childName).filter(Boolean).join(', ') || null,
      interest,
      source: leadSource,
      appointmentNotes: leadNotes,
      campaignId: campaign?.id ?? null,
      campaignName: campaign?.name ?? null,
    });

    const registrations = customerId
      ? await Promise.all(children.map(child => autoRegisterLeadToCycle({
        source: leadSource,
        customerId,
        childName: child.childName || null,
        childAge: child.childAge || null,
        grade: child.grade || null,
        cycleId,
        interest: interest || null,
      })))
      : [{ status: 'skipped' as const, reason: 'missing_customer' }];
    const autoRegistration = registrations[0] ?? { status: 'skipped' as const, reason: 'missing_child' };
    const registeredChildren = registrations.filter(reg => reg.status === 'registered').length;
    const alreadyRegisteredChildren = registrations.filter(reg => reg.status === 'already_registered').length;
    const billableChildren = registeredChildren || (alreadyRegisteredChildren === children.length ? 0 : children.length);
    let payment: { url: string; amount: number; maxPayments: number } | null = null;
    const existingPaymentLink = cycleId ? await findCyclePaymentLink(cycleId) : null;
    const maxInstallments = configuredMaxInstallments || existingPaymentLink?.maxPayments || 1;

    if (cycleId && billableChildren > 0) {
      const cycle = await prisma.cycle.findFirst({
        where: { id: cycleId, deletedAt: null },
        select: {
          name: true,
          defaultRegistrationAmount: true,
          course: { select: { name: true } },
        },
      });
      const amountPerChild = Number(cycle?.defaultRegistrationAmount || 0);
      if (cycle && amountPerChild > 0) {
        const amount = amountPerChild * billableChildren;
        const childLabel = billableChildren === 1 ? 'ילד אחד' : `${billableChildren} ילדים`;
        const result = await createWooPaymentLink({
          customerId,
          customerName: name,
          customerPhone: phone,
          customerEmail: email,
          amount,
          description: `רישום למחזור ${cycle.name} - ${childLabel} [cycle:${cycleId}]`,
          installments: maxInstallments,
          baseUrl: publicOrigin(req),
        });
        payment = {
          url: result.paymentUrl,
          amount: result.amount,
          maxPayments: result.maxInstallments,
        };
      }
    }

    if (!payment) {
      payment = existingPaymentLink ? {
        url: publicPaymentUrl(req, existingPaymentLink.code) as string,
        amount: Number(existingPaymentLink.amount),
        maxPayments: existingPaymentLink.maxPayments,
      } : null;
    }

    console.log(`[Campaign] Lead ${lead.id} — ${isDuplicate ? 'merged duplicate' : (isNew ? 'new' : 'existing')} customer ${customerId}`);

    // Send welcome WhatsApp template (gated by LEAD_WELCOME_WA_ENABLED)
    if (phone) {
      sendLeadWelcomeTemplate(phone, name)
        .catch(err => console.error('[Campaign] welcome template error:', err));
    }

    // Also update campaign_recipients if recipient found by phone
    if (campaignId && phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      await prisma.campaignRecipient.updateMany({
        where: {
          campaignId,
          phone: { contains: cleanPhone.slice(-9) },
        },
        data: {
          clickedAt: new Date(),
        },
      });
    }

    res.status(201).json({
      success: true,
      leadId: lead.id,
      customerId,
      registration: autoRegistration,
      registrations,
      payment,
    });
  } catch (err) {
    next(err);
  }
});
