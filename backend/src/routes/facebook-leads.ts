import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { findOrCreateCustomer } from '../utils/lead-customer.js';
import { initiateVapiCall } from '../services/vapi.js';

export const facebookLeadsRouter = Router();

const FB_PAGE_ID = process.env.FB_PAGE_ID || '124822734055754';
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || '';
const FB_VERIFY_TOKEN = process.env.FB_WEBHOOK_VERIFY_TOKEN || 'haitech-fb-verify-2026';
const FB_APP_SECRET = process.env.FB_APP_SECRET || '';

// ─── WEBHOOK (public) ───────────────────────────────────────────────────────

// GET /api/facebook/webhook — Meta verification challenge
facebookLeadsRouter.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
    console.log('[FB] Webhook verified');
    res.status(200).send(challenge);
  } else {
    console.warn('[FB] Webhook verification failed', { mode, token });
    res.status(403).send('Forbidden');
  }
});

// POST /api/facebook/webhook — receive lead events
facebookLeadsRouter.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;

    // Always respond 200 quickly to Meta
    res.status(200).json({ status: 'ok' });

    if (body.object !== 'page') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'leadgen') continue;
        const leadgenId = change.value?.leadgen_id;
        if (!leadgenId) continue;

        console.log('[FB] New lead received:', leadgenId);
        await fetchAndSaveLead(leadgenId);
      }
    }
  } catch (error) {
    console.error('[FB] Webhook error:', error);
  }
});

// ─── AUTHENTICATED ROUTES ───────────────────────────────────────────────────

facebookLeadsRouter.use(authenticate);
facebookLeadsRouter.use(managerOrAdmin);

// GET /api/facebook/leads — list leads
facebookLeadsRouter.get('/leads', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (status && ['new', 'contacted', 'converted', 'dismissed'].includes(status)) {
      where.status = status;
    }

    const [items, total] = await Promise.all([
      prisma.facebookLead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
        },
      }),
      prisma.facebookLead.count({ where }),
    ]);

    res.json({
      data: items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/facebook/leads/:id — update status/notes
facebookLeadsRouter.patch('/leads/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new AppError(400, 'Invalid ID');

    const { status, notes, crmCustomerId } = req.body;
    const data: any = {};
    if (status) {
      if (!['new', 'contacted', 'converted', 'dismissed'].includes(status)) {
        throw new AppError(400, 'Invalid status');
      }
      data.status = status;
    }
    if (notes !== undefined) data.notes = notes;
    if (crmCustomerId !== undefined) data.crmCustomerId = crmCustomerId || null;

    const lead = await prisma.facebookLead.update({
      where: { id },
      data,
      include: { customer: { select: { id: true, name: true } } },
    });

    res.json(lead);
  } catch (error) {
    next(error);
  }
});

// POST /api/facebook/sync — pull existing leads from Meta
facebookLeadsRouter.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!FB_PAGE_ACCESS_TOKEN) {
      throw new AppError(400, 'FB_PAGE_ACCESS_TOKEN not configured. Please set it in .env');
    }

    // Fetch all lead forms for the page
    const formsRes = await fetch(
      `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/leadgen_forms?access_token=${FB_PAGE_ACCESS_TOKEN}&limit=20`
    );
    const formsData = await formsRes.json() as any;

    if (formsData.error) {
      throw new AppError(400, `Facebook API error: ${formsData.error.message}`);
    }

    let imported = 0;
    let skipped = 0;

    for (const form of formsData.data || []) {
      // Fetch leads for this form
      const leadsRes = await fetch(
        `https://graph.facebook.com/v19.0/${form.id}/leads?access_token=${FB_PAGE_ACCESS_TOKEN}&limit=100&fields=id,created_time,field_data,ad_id,ad_name,campaign_id,campaign_name,adset_name`
      );
      const leadsData = await leadsRes.json() as any;

      for (const lead of leadsData.data || []) {
        const existing = await prisma.facebookLead.findUnique({
          where: { fbLeadId: lead.id },
        });
        if (existing) { skipped++; continue; }

        await saveLead(lead, form.id);
        imported++;
      }
    }

    res.json({ success: true, imported, skipped });
  } catch (error) {
    next(error);
  }
});

// ─── HELPERS ────────────────────────────────────────────────────────────────

async function fetchAndSaveLead(leadgenId: string) {
  if (!FB_PAGE_ACCESS_TOKEN) {
    console.warn('[FB] No FB_PAGE_ACCESS_TOKEN — cannot fetch lead details');
    return;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${FB_PAGE_ACCESS_TOKEN}&fields=id,created_time,field_data,ad_id,ad_name,campaign_id,campaign_name,adset_name,form_id`
    );
    const lead = await res.json() as any;
    if (lead.error) {
      console.error('[FB] Error fetching lead:', lead.error.message);
      return;
    }
    await saveLead(lead, lead.form_id);
  } catch (err) {
    console.error('[FB] fetchAndSaveLead error:', err);
  }
}

async function saveLead(lead: any, formId?: string) {
  const fields: Record<string, string> = {};
  for (const f of lead.field_data || []) {
    fields[f.name] = Array.isArray(f.values) ? f.values[0] : f.values;
  }

  const fullName =
    fields['full_name'] ||
    fields['שם מלא'] ||
    fields['name'] ||
    [fields['first_name'], fields['last_name']].filter(Boolean).join(' ') ||
    null;

  const phone =
    fields['phone_number'] ||
    fields['phone'] ||
    fields['טלפון'] ||
    fields['מספר טלפון'] ||
    null;

  const email = fields['email'] || fields['מייל'] || null;
  const city = fields['city'] || fields['עיר'] || null;
  const childName = fields['child_name'] || fields['שם הילד'] || fields['שם ילד'] || null;
  const childAge = fields['child_age'] || fields['גיל הילד'] || fields['גיל'] || null;
  const interest = fields['interest'] || fields['תחום עניין'] || fields['קורס'] || null;

  const saved = await prisma.facebookLead.upsert({
    where: { fbLeadId: lead.id },
    update: {},
    create: {
      fbLeadId: lead.id,
      formId: formId || lead.form_id || null,
      adId: lead.ad_id || null,
      adName: lead.ad_name || null,
      campaignId: lead.campaign_id || null,
      campaignName: lead.campaign_name || null,
      adsetName: lead.adset_name || null,
      fullName,
      phone,
      email,
      city,
      childName,
      childAge,
      interest,
      rawData: lead.field_data || null,
      fbCreatedTime: lead.created_time ? new Date(lead.created_time) : null,
    },
  });

  // Link to CRM customer (find or create) + trigger VAPI outbound call
  if (saved && !saved.crmCustomerId) {
    try {
      const noteDetails = [
        interest && `תחום עניין: ${interest}`,
        childName && `ילד: ${childName}`,
        childAge && `גיל: ${childAge}`,
        city && `עיר: ${city}`,
        lead.ad_name && `מודעה: ${lead.ad_name}`,
        lead.campaign_name && `קמפיין: ${lead.campaign_name}`,
      ].filter(Boolean).join(' | ');

      const { customerId, isNew } = await findOrCreateCustomer({
        name: fullName || undefined,
        phone: phone || undefined,
        email: email || undefined,
        source: 'facebook',
        notes: noteDetails || 'ליד מפייסבוק',
        childName: childName || undefined,
        childAge: childAge || undefined,
      });

      if (customerId) {
        await prisma.facebookLead.update({
          where: { id: saved.id },
          data: { crmCustomerId: customerId },
        });
        console.log(`[FB] Lead ${lead.id} linked to ${isNew ? 'new' : 'existing'} customer ${customerId}`);
      }

      // Trigger VAPI outbound call if we have enough info
      if (phone && fullName) {
        await initiateVapiCall({
          customerId: customerId || undefined,
          customerName: fullName,
          customerPhone: phone,
          customerEmail: email || undefined,
          childName: childName || undefined,
          interest: interest || undefined,
          source: 'facebook',
        });
        console.log(`[FB] VAPI call initiated for lead ${lead.id}`);
      }
    } catch (err) {
      console.error('[FB] Customer linkage / VAPI error:', err);
    }
  }
}
