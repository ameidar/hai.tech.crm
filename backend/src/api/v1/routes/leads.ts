import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireScope } from '../middleware/scope-check.js';
import { validateParams, validateQuery, validateBody } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { ForbiddenError } from '../../../common/errors/index.js';

const router = Router();

router.use(authenticate);

const leadQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  salesStatus: z.string().optional(),
  source: z.string().optional(),
  assignedToId: z.string().optional(),
  followUp: z.enum(['due']).optional(),
  updatedSince: z.string().datetime().optional(),
  includePayments: z.preprocess((value) => value === 'true' || value === true, z.boolean().default(false)),
});

const updateLeadSchema = z.object({
  salesStatus: z.string().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  lastContactResult: z.string().nullable().optional(),
  activityType: z.string().optional(),
  activityNote: z.string().nullable().optional(),
}).strict();

const createActivitySchema = z.object({
  type: z.string().default('note'),
  result: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  salesStatus: z.string().optional(),
}).strict();

function userId(req: AuthRequest) {
  return req.user?.userId || null;
}

function canReadPayments(req: AuthRequest) {
  const apiScopes = req.apiKey?.scopes || [];
  if (apiScopes.includes('*') || apiScopes.includes('read:*') || apiScopes.includes('read:payments')) {
    return true;
  }
  return req.user?.role === 'admin' || req.user?.role === 'manager';
}

function requirePaymentRead(req: AuthRequest) {
  if (!canReadPayments(req)) {
    throw new ForbiddenError('Missing required scope: read:payments');
  }
}

function leadInclude(withActivities = false) {
  return {
    assignedTo: { select: { id: true, name: true, email: true, role: true } },
    ...(withActivities ? {
      activities: {
        orderBy: { createdAt: 'desc' as const },
        take: 25,
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      },
    } : {}),
  };
}

type PaymentForLead = {
  id: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  description: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: Date | null;
  invoiceUrl: string | null;
  invoiceNumber: string | null;
  paymentMethod: string | null;
};

type LeadForPaymentMatch = {
  customerId?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
};

function cleanContact(value?: string | null) {
  const clean = value?.trim();
  return clean || null;
}

function matchesLeadPayment(lead: LeadForPaymentMatch, payment: PaymentForLead) {
  if (lead.customerId) return payment.customerId === lead.customerId;
  const phone = cleanContact(lead.customerPhone);
  const email = cleanContact(lead.customerEmail)?.toLowerCase();
  return (
    (phone && payment.customerPhone === phone) ||
    (email && payment.customerEmail?.toLowerCase() === email)
  );
}

function summarizePayments(lead: LeadForPaymentMatch, payments: PaymentForLead[]) {
  const matched = payments
    .filter((payment) => matchesLeadPayment(lead, payment))
    .sort((a, b) => new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime());

  return {
    hasPaid: matched.length > 0,
    paidCount: matched.length,
    totalPaid: matched.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    latestPaidAt: matched[0]?.paidAt || null,
    latestPayment: matched[0] || null,
    payments: matched,
  };
}

async function findPaidPaymentsForLeads(leads: LeadForPaymentMatch[]) {
  const customerIds = [...new Set(leads.map((lead) => cleanContact(lead.customerId)).filter(Boolean))];
  const phones = [...new Set(leads.map((lead) => cleanContact(lead.customerPhone)).filter(Boolean))];
  const emails = [...new Set(leads.map((lead) => cleanContact(lead.customerEmail)?.toLowerCase()).filter(Boolean))];

  const or: any[] = [];
  if (customerIds.length) or.push({ customerId: { in: customerIds } });
  if (phones.length) or.push({ customerPhone: { in: phones } });
  if (emails.length) or.push({ customerEmail: { in: emails } });
  if (!or.length) return [];

  return prisma.payment.findMany({
    where: { status: 'paid', OR: or },
    orderBy: { paidAt: 'desc' },
    select: {
      id: true,
      customerId: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      description: true,
      amount: true,
      currency: true,
      status: true,
      paidAt: true,
      invoiceUrl: true,
      invoiceNumber: true,
      paymentMethod: true,
    },
  });
}

router.get('/', requireScope('read:leads'), validateQuery(leadQuerySchema), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof leadQuerySchema>;
    const where: any = {};

    if (query.salesStatus) where.salesStatus = query.salesStatus;
    if (query.source) where.source = query.source;
    if (query.assignedToId) where.assignedToId = query.assignedToId === 'unassigned' ? null : query.assignedToId;
    if (query.followUp === 'due') {
      where.nextFollowUpAt = { lte: new Date() };
      where.salesStatus = { notIn: ['converted', 'not_relevant'] };
    }
    if (query.updatedSince) where.updatedAt = { gte: new Date(query.updatedSince) };

    const [items, total] = await Promise.all([
      prisma.leadAppointment.findMany({
        where,
        orderBy: [{ nextFollowUpAt: 'asc' }, { updatedAt: 'desc' }],
        skip: query.offset,
        take: query.limit,
        include: leadInclude(false),
      }),
      prisma.leadAppointment.count({ where }),
    ]);

    if (query.includePayments) {
      requirePaymentRead(req as AuthRequest);
      const payments = await findPaidPaymentsForLeads(items);
      res.json({
        data: items.map((item) => ({
          ...item,
          paymentSummary: summarizePayments(item, payments),
        })),
        meta: { total, limit: query.limit, offset: query.offset },
      });
      return;
    }

    res.json({ data: items, meta: { total, limit: query.limit, offset: query.offset } });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', requireScope('read:leads'), validateParams(idParamSchema), async (req, res, next) => {
  try {
    const item = await prisma.leadAppointment.findUnique({
      where: { id: req.params.id },
      include: leadInclude(true),
    });

    if (!item) {
      res.status(404).json({ error: { message: 'Lead not found' } });
      return;
    }

    if (req.query.includePayments === 'true') {
      requirePaymentRead(req as AuthRequest);
      const payments = await findPaidPaymentsForLeads([item]);
      res.json({ data: { ...item, paymentSummary: summarizePayments(item, payments) } });
      return;
    }

    res.json({ data: item });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/:id',
  requireScope('write:leads'),
  validateParams(idParamSchema),
  validateBody(updateLeadSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof updateLeadSchema>;
      const nextFollowUpAt = body.nextFollowUpAt === undefined
        ? undefined
        : body.nextFollowUpAt
          ? new Date(body.nextFollowUpAt)
          : null;

      const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.leadAppointment.update({
          where: { id: req.params.id },
          data: {
            ...(body.salesStatus ? { salesStatus: body.salesStatus } : {}),
            ...(body.assignedToId !== undefined ? { assignedToId: body.assignedToId } : {}),
            ...(nextFollowUpAt !== undefined ? { nextFollowUpAt } : {}),
            ...(body.lastContactResult !== undefined ? {
              lastContactResult: body.lastContactResult,
              lastContactedAt: body.lastContactResult ? new Date() : null,
            } : {}),
          },
          include: leadInclude(true),
        });

        if (body.activityType || body.activityNote || body.lastContactResult) {
          await tx.leadActivity.create({
            data: {
              leadAppointmentId: req.params.id,
              userId: userId(req),
              type: body.activityType || 'note',
              result: body.lastContactResult || null,
              note: body.activityNote || null,
              nextFollowUpAt: nextFollowUpAt === undefined ? null : nextFollowUpAt,
            },
          });
        }

        return updated;
      });

      res.json({ data: item });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/:id/activities',
  requireScope('write:leads'),
  validateParams(idParamSchema),
  validateBody(createActivitySchema),
  async (req: AuthRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof createActivitySchema>;
      const nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;

      const activity = await prisma.$transaction(async (tx) => {
        const created = await tx.leadActivity.create({
          data: {
            leadAppointmentId: req.params.id,
            userId: userId(req),
            type: body.type,
            result: body.result || null,
            note: body.note || null,
            nextFollowUpAt,
          },
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        });

        await tx.leadAppointment.update({
          where: { id: req.params.id },
          data: {
            ...(body.salesStatus ? { salesStatus: body.salesStatus } : {}),
            ...(body.result ? { lastContactResult: body.result, lastContactedAt: new Date() } : {}),
            ...(body.nextFollowUpAt !== undefined ? { nextFollowUpAt } : {}),
          },
        });

        return created;
      });

      res.status(201).json({ data: activity });
    } catch (error) {
      next(error);
    }
  }
);

export { router as leadsRouter };
