import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { findOrCreateCustomer } from '../utils/lead-customer.js';

export const campaignLeadsRouter = Router();

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
    };

    if (!name || !phone) {
      res.status(400).json({ error: 'שם וטלפון הם שדות חובה' });
      return;
    }

    // Find or create customer + add to communication history
    const { customerId, isNew } = await findOrCreateCustomer({
      name,
      phone,
      email,
      source: campaignId ? `campaign:${campaignId}` : 'campaign',
      notes: interest ? `תחום עניין: ${interest}` : 'ליד מקמפיין',
    });

    // Create LeadAppointment
    const lead = await prisma.leadAppointment.create({
      data: {
        customerName: name,
        customerPhone: phone,
        customerEmail: email,
        interest,
        source: campaignId ? `campaign:${campaignId}` : 'campaign',
        ...(customerId && { customerId }),
      },
    });

    console.log(`[Campaign] Lead ${lead.id} — ${isNew ? 'new' : 'existing'} customer ${customerId}`);

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

    res.status(201).json({ success: true, leadId: lead.id });
  } catch (err) {
    next(err);
  }
});
