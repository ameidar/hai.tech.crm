import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { findOrCreateCustomer } from '../utils/lead-customer.js';
import { sendLeadWelcomeTemplate } from '../services/lead-welcome.js';
import { findOrCreateLeadAppointment } from '../utils/lead-dedup.js';
import { autoRegisterLeadToCycle } from '../services/lead-cycle-registration.js';

export const campaignLeadsRouter = Router();

function getCampaignCycleId(audienceFilters: unknown): string | null {
  if (!audienceFilters || typeof audienceFilters !== 'object' || Array.isArray(audienceFilters)) {
    return null;
  }

  const value = (audienceFilters as { cycleId?: unknown }).cycleId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
    const { campaignId, name, phone, email, interest, childName, childAge, grade } = req.body as {
      campaignId?: string;
      name?: string;
      phone?: string;
      email?: string;
      interest?: string;
      childName?: string;
      childAge?: string;
      grade?: string;
    };

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

    if (cycleId && !childName?.trim()) {
      res.status(400).json({ error: 'שם הילד הוא שדה חובה להרשמה למחזור' });
      return;
    }

    const leadSource = campaignId ? `campaign:${campaignId}` : 'campaign';
    const leadNotes = [
      cycleId ? `הרשמה למחזור: ${cycleId}` : null,
      interest ? `תחום עניין: ${interest}` : null,
      childName ? `שם הילד: ${childName}` : null,
      childAge ? `גיל הילד: ${childAge}` : null,
      grade ? `כיתה: ${grade}` : null,
    ].filter(Boolean).join(' | ') || 'ליד מקמפיין';

    // Find or create customer + add to communication history
    const { customerId, isNew } = await findOrCreateCustomer({
      name,
      phone,
      email,
      source: leadSource,
      notes: leadNotes,
      childName,
      childAge,
    });

    // Create or merge LeadAppointment (dedup by phone)
    const { lead, isDuplicate } = await findOrCreateLeadAppointment({
      customerId: customerId ?? null,
      customerName: name,
      customerPhone: phone,
      customerEmail: email,
      childName: childName || null,
      interest,
      source: leadSource,
      appointmentNotes: leadNotes,
      campaignId: campaign?.id ?? null,
      campaignName: campaign?.name ?? null,
    });

    const autoRegistration = customerId
      ? await autoRegisterLeadToCycle({
        source: leadSource,
        customerId,
        childName: childName || null,
        childAge: childAge || null,
        grade: grade || null,
        cycleId,
        interest: interest || null,
      })
      : { status: 'skipped' as const, reason: 'missing_customer' };
    const paymentLink = cycleId ? await findCyclePaymentLink(cycleId) : null;

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
