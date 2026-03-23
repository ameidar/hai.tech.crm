import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { resolveAudience, sendCampaign, buildTrackingUrl, AudienceFilters } from '../services/campaigns.service.js';
import { generateCampaignAI } from '../services/campaignAI.service.js';
import { sendEmail } from '../services/email/sender.js';
import axios from 'axios';

export const campaignsRouter = Router();

// ─── Public Routes (no auth) ───────────────────────────────────────────────

/**
 * GET /api/campaigns/click?cid=CAMPAIGN_ID&rid=RECIPIENT_ID&url=TARGET_URL
 * UTM click tracking — increments click_count and redirects
 */
campaignsRouter.get('/click', async (req: Request, res: Response) => {
  const { cid, rid, url } = req.query as Record<string, string>;
  const redirectTo = url || 'https://hai.tech';

  try {
    if (cid && rid) {
      await prisma.campaignRecipient.updateMany({
        where: { id: rid, campaignId: cid },
        data: {
          clickedAt: new Date(),
          clickCount: { increment: 1 },
        },
      });
    }
  } catch (err) {
    console.error('Click tracking error:', err);
  }

  res.redirect(302, redirectTo);
});

/**
 * GET /api/campaigns/unsubscribe?rid=RECIPIENT_ID
 * Email unsubscribe — marks customer as unsubscribed, shows confirmation page
 */
campaignsRouter.get('/unsubscribe', async (req: Request, res: Response) => {
  const { rid } = req.query as Record<string, string>;

  const html = (title: string, body: string, color = '#10b981') => `
<!DOCTYPE html><html dir="rtl" lang="he"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:Arial,sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#fff;border-radius:16px;padding:40px 48px;max-width:420px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .icon{font-size:48px;margin-bottom:16px}
  h1{color:#111;font-size:22px;margin:0 0 12px}
  p{color:#555;font-size:15px;line-height:1.6;margin:0}
  .btn{display:inline-block;margin-top:24px;padding:10px 24px;background:${color};color:#fff;border-radius:8px;text-decoration:none;font-size:14px}
</style></head><body><div class="card">
<div class="icon">${color === '#10b981' ? '✅' : '⚠️'}</div>
<h1>${title}</h1><p>${body}</p>
<a href="https://hai.tech" class="btn">חזרה לאתר</a>
</div></body></html>`;

  if (!rid) {
    res.status(400).send(html('שגיאה', 'לינק לא תקין.', '#ef4444'));
    return;
  }

  try {
    const recipient = await prisma.campaignRecipient.findUnique({
      where: { id: rid },
      include: { customer: true },
    });

    if (!recipient) {
      res.status(404).send(html('לא נמצא', 'לינק לא תקין או פג תוקף.', '#f59e0b'));
      return;
    }

    // Mark customer as unsubscribed (if has a customer)
    if (recipient.customerId) {
      await prisma.customer.update({
        where: { id: recipient.customerId },
        data: { emailUnsubscribed: true, emailUnsubscribedAt: new Date() },
      });
    }

    // Log the unsubscribe on the recipient record
    await prisma.campaignRecipient.update({
      where: { id: rid },
      data: { status: 'unsubscribed' },
    });

    const name = recipient.customer?.name || recipient.recipientName || '';
    res.send(html(
      'הוסרת בהצלחה מרשימת התפוצה',
      `${name ? `שלום ${name},<br><br>` : ''}הוסרת מרשימת התפוצה שלנו ולא תקבל מיילים שיווקיים בעתיד.<br><br>אם הוסרת בטעות, פנה אלינו בכתובת info@hai.tech`
    ));
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.status(500).send(html('שגיאה', 'אירעה שגיאה. נסה שוב מאוחר יותר.', '#ef4444'));
  }
});

/**
 * GET /api/campaigns/track/open/:campaignId/:recipientId
 * Email open tracking — records first open, returns a 1×1 transparent GIF
 */
campaignsRouter.get('/track/open/:campaignId/:recipientId', async (req: Request, res: Response) => {
  const { campaignId, recipientId } = req.params;
  // 1×1 transparent GIF
  const pixel = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  );
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.end(pixel);

  // Fire-and-forget — don't block the response
  prisma.campaignRecipient.updateMany({
    where: { id: recipientId, campaignId, openedAt: null },
    data: { openedAt: new Date() },
  }).catch(err => console.error('Open tracking error:', err));
});

// ─── Protected Routes (auth required) ─────────────────────────────────────

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

    const campaignIds = campaigns.map(c => c.id);

    // Click counts
    const clickCounts = await prisma.campaignRecipient.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, clickCount: { gt: 0 } },
      _sum: { clickCount: true },
    });
    const clickMap: Record<string, number> = {};
    for (const cc of clickCounts) clickMap[cc.campaignId] = cc._sum.clickCount ?? 0;

    // Pending counts per campaign
    const pendingCounts = await prisma.campaignRecipient.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, status: 'pending' },
      _count: { _all: true },
    });
    const pendingMap: Record<string, number> = {};
    for (const p of pendingCounts) pendingMap[p.campaignId] = p._count._all;

    // Sent today counts
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const sentToday = await prisma.campaignRecipient.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, status: 'sent', sentAt: { gte: todayStart } },
      _count: { _all: true },
    });
    const sentTodayMap: Record<string, number> = {};
    for (const s of sentToday) sentTodayMap[s.campaignId] = s._count._all;

    // Opened counts
    const openedCounts = await prisma.campaignRecipient.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, openedAt: { not: null } },
      _count: { _all: true },
    });
    const openedMap: Record<string, number> = {};
    for (const o of openedCounts) openedMap[o.campaignId] = o._count._all;

    // Unsubscribed counts
    const unsubscribedCounts = await prisma.campaignRecipient.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, status: 'unsubscribed' },
      _count: { _all: true },
    });
    const unsubscribedMap: Record<string, number> = {};
    for (const u of unsubscribedCounts) unsubscribedMap[u.campaignId] = u._count._all;

    res.json(campaigns.map(c => ({
      ...c,
      totalClicks: clickMap[c.id] ?? 0,
      pendingCount: pendingMap[c.id] ?? 0,
      sentTodayCount: sentTodayMap[c.id] ?? 0,
      openedCount: openedMap[c.id] ?? 0,
      unsubscribedCount: unsubscribedMap[c.id] ?? 0,
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns — create draft
campaignsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, channel, audienceFilters, subject, contentHtml, contentWa, landingUrl } = req.body;
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
        landingUrl,
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
    const { name, description, channel, audienceFilters, subject, contentHtml, contentWa, scheduledAt, landingUrl } = req.body;
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
        ...(landingUrl !== undefined && { landingUrl }),
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
    const userContext: string | undefined = req.body.userContext;

    // Fetch courses + branches for context
    const [courses, branches] = await Promise.all([
      prisma.course.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    ]);

    const variants = await generateCampaignAI(filters, courses, branches, userContext);

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

// POST /api/campaigns/:id/test-send
campaignsRouter.post('/:id/test-send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, email } = req.body as { phone?: string; email?: string };
    const campaignId = req.params.id;

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });

    const channel = campaign.channel;
    const testPrefix = '[🧪 הודעת בדיקה] ';
    const dummy = { customerName: 'הורה לדוגמה', studentName: 'ילד לדוגמה' };

    // Build test content with dummy placeholders replaced
    const testHtml = (campaign.contentHtml || '')
      .replace(/\{שם_הורה\}/g, dummy.customerName)
      .replace(/\{שם_ילד\}/g, dummy.studentName)
      .replace(/\{utm_link\}/g, '#utm-test');

    const testWa = (campaign.contentWa || '')
      .replace(/\{שם_הורה\}/g, dummy.customerName)
      .replace(/\{שם_ילד\}/g, dummy.studentName)
      .replace(/\{utm_link\}/g, 'https://hai.tech');

    const waToken = process.env.WA_CLOUD_TOKEN;
    const waPhoneId = process.env.WA_CLOUD_PHONE_NUMBER_ID;

    const sentTo: string[] = [];

    // Determine target phone/email
    const targetEmail = email || (channel === 'email' ? undefined : undefined);
    const targetPhone = phone || (channel === 'whatsapp' ? undefined : undefined);

    // Send test email
    if ((channel === 'email' || channel === 'both') && targetEmail) {
      await sendEmail({
        to: targetEmail,
        subject: testPrefix + (campaign.subject || 'הודעת בדיקה'),
        html: testHtml,
      });
      sentTo.push(targetEmail);
    }

    // Send test WhatsApp
    if ((channel === 'whatsapp' || channel === 'both') && targetPhone) {
      const cleanPhone = targetPhone.replace(/\D/g, '');
      await axios.post(
        `https://graph.facebook.com/v18.0/${waPhoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'text',
          text: { body: testPrefix + testWa },
        },
        {
          headers: {
            Authorization: `Bearer ${waToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      sentTo.push(targetPhone);
    }

    // Fallback: if no specific channel match, try the provided contact
    if (sentTo.length === 0 && (phone || email)) {
      const contact = phone || email!;
      if (phone && waToken && waPhoneId) {
        const cleanPhone = phone.replace(/\D/g, '');
        await axios.post(
          `https://graph.facebook.com/v18.0/${waPhoneId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'text',
            text: { body: testPrefix + (testWa || testHtml.replace(/<[^>]+>/g, '')) },
          },
          {
            headers: {
              Authorization: `Bearer ${waToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
        sentTo.push(contact);
      } else if (email) {
        await sendEmail({
          to: email,
          subject: testPrefix + (campaign.subject || 'הודעת בדיקה'),
          html: testHtml || `<p>${testWa}</p>`,
        });
        sentTo.push(email);
      }
    }

    if (sentTo.length === 0) {
      res.status(400).json({ error: 'לא נמצא כתובת שליחה. ציין phone או email.' });
      return;
    }

    res.json({ success: true, sentTo: sentTo.join(', ') });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/send
campaignsRouter.post('/:id/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaignId = req.params.id;
    const { scheduledAt, dailyLimit } = req.body as { scheduledAt?: string; dailyLimit?: number };

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: { _count: { select: { recipients: { where: { status: 'pending' } } } } },
    });

    const pendingCount = (campaign as any)._count?.recipients ?? 0;

    // Allow re-sending if there are still pending recipients (daily batch mode)
    const isResend = pendingCount > 0 && campaign.status !== 'draft' && campaign.status !== 'scheduled';
    if (!isResend && campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      res.status(400).json({ error: 'No pending recipients to send' });
      return;
    }

    if (!isResend) {
      // First send: build audience → create recipients
      const filters = campaign.audienceFilters as AudienceFilters;

      // Auto-enforce contact requirement based on channel:
      // email-only → must have email, whatsapp-only → must have phone
      if (campaign.channel === 'email') {
        filters.hasEmail = true;
      } else if (campaign.channel === 'whatsapp') {
        filters.hasPhone = true;
      }

      const audience = await resolveAudience(filters);

      await prisma.campaignRecipient.createMany({
        data: audience.recipients.map(r => {
          const isAnon = r.customerId.startsWith('file:');
          return {
            campaignId,
            customerId: isAnon ? null : r.customerId,
            recipientName: isAnon ? r.customerName : null,
            phone: r.phone,
            email: r.email,
            status: 'pending',
          };
        }),
        skipDuplicates: true,
      });

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { recipientCount: audience.count },
      });
    }

    const batchSize = dailyLimit ?? undefined;

    if (scheduledAt) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'scheduled', scheduledAt: new Date(scheduledAt) },
      });
      res.json({ status: 'scheduled', scheduledAt });
    } else {
      // Fire-and-forget sending with optional daily limit
      sendCampaign(campaignId, batchSize).catch(err => {
        console.error(`Campaign ${campaignId} send error:`, err);
      });
      res.json({ status: 'sending', dailyLimit: batchSize ?? null, pendingBefore: pendingCount });
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
