import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { resolveAudience, sendCampaign, AudienceFilters } from '../services/campaigns.service.js';
import { generateCampaignAI } from '../services/campaignAI.service.js';

export const campaignsRouter = Router();

campaignsRouter.use(authenticate);
campaignsRouter.use(managerOrAdmin);

// GET /api/campaigns — list
campaignsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { recipients: true } },
      },
    });
    res.json(campaigns);
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns — create draft
campaignsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, channel, audienceFilters, subject, contentHtml, contentWa } = req.body;
    const userId = req.user!.userId;

    const campaign = await prisma.campaign.create({
      data: {
        name,
        description,
        channel: channel || 'email',
        audienceFilters: audienceFilters || {},
        subject,
        contentHtml,
        contentWa,
        createdById: userId,
      },
    });
    res.status(201).json(campaign);
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/preview-audience — must come before /:id
campaignsRouter.post('/preview-audience', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters: AudienceFilters = req.body.filters || req.body;
    const result = await resolveAudience(filters);
    res.json({ count: result.count, sample: result.sample });
  } catch (err) {
    next(err);
  }
});

// GET /api/campaigns/:id — single
campaignsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { recipients: true } },
      },
    });
    res.json(campaign);
  } catch (err) {
    next(err);
  }
});

// PUT /api/campaigns/:id — update
campaignsRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, channel, audienceFilters, subject, contentHtml, contentWa, scheduledAt } = req.body;
    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(channel !== undefined && { channel }),
        ...(audienceFilters !== undefined && { audienceFilters }),
        ...(subject !== undefined && { subject }),
        ...(contentHtml !== undefined && { contentHtml }),
        ...(contentWa !== undefined && { contentWa }),
        ...(scheduledAt !== undefined && { scheduledAt: scheduledAt ? new Date(scheduledAt) : null }),
      },
    });
    res.json(campaign);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/campaigns/:id
campaignsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.campaign.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/generate-ai
campaignsRouter.post('/:id/generate-ai', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: req.params.id },
    });

    const filters = campaign.audienceFilters as AudienceFilters;

    // Fetch courses + branches for context
    const [courses, branches] = await Promise.all([
      prisma.course.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    ]);

    const variants = await generateCampaignAI(filters, courses, branches);

    // Store AI context
    await prisma.campaign.update({
      where: { id: req.params.id },
      data: { aiContext: JSON.parse(JSON.stringify({ variants, generatedAt: new Date().toISOString() })) },
    });

    res.json({ variants });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/send
campaignsRouter.post('/:id/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaignId = req.params.id;
    const { scheduledAt } = req.body;

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });

    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      res.status(400).json({ error: 'Campaign already sent or in progress' });
      return;
    }

    const filters = campaign.audienceFilters as AudienceFilters;
    const audience = await resolveAudience(filters);

    // Build recipients
    await prisma.campaignRecipient.createMany({
      data: audience.recipients.map(r => ({
        campaignId,
        customerId: r.customerId,
        phone: r.phone,
        email: r.email,
        status: 'pending',
      })),
      skipDuplicates: true,
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { recipientCount: audience.count },
    });

    if (scheduledAt) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'scheduled', scheduledAt: new Date(scheduledAt) },
      });
      res.json({ status: 'scheduled', scheduledAt, recipientCount: audience.count });
    } else {
      // Fire-and-forget sending
      sendCampaign(campaignId).catch(err => {
        console.error(`Campaign ${campaignId} send error:`, err);
      });
      res.json({ status: 'sending', recipientCount: audience.count });
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/campaigns/:id/recipients — paginated
campaignsRouter.get('/:id/recipients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(String(req.query.page || '1'));
    const limit = parseInt(String(req.query.limit || '50'));
    const skip = (page - 1) * limit;

    const [recipients, total] = await Promise.all([
      prisma.campaignRecipient.findMany({
        where: { campaignId: req.params.id },
        skip,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.campaignRecipient.count({ where: { campaignId: req.params.id } }),
    ]);

    res.json({ recipients, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});
