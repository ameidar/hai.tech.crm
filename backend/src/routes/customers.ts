import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin, salesOrAbove } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createCustomerSchema, updateCustomerSchema, createStudentSchema, paginationSchema, uuidSchema } from '../types/schemas.js';
import { logAudit } from '../utils/audit.js';

// Customer ids are usually UUIDs, but Fireberry-imported records use CUIDs — accept any non-empty id here.
const customerIdSchema = z.string().min(1);

// Count related records pointing at a customer (used by the merge preview + executor).
async function countCustomerRelations(customerId: string) {
  const [students, quotes, leadAppointments, upsellLeads, campaignRecipients, facebookLeads, payments, paymentLinks] =
    await Promise.all([
      prisma.student.count({ where: { customerId } }),
      prisma.quote.count({ where: { customerId } }),
      prisma.leadAppointment.count({ where: { customerId } }),
      prisma.upsellLead.count({ where: { customerId } }),
      prisma.campaignRecipient.count({ where: { customerId } }),
      prisma.facebookLead.count({ where: { crmCustomerId: customerId } }),
      prisma.payment.count({ where: { customerId } }),
      prisma.paymentLink.count({ where: { customerId } }),
    ]);
  return { students, quotes, leadAppointments, upsellLeads, campaignRecipients, facebookLeads, payments, paymentLinks };
}

// Scalar fields that can be carried over from the merged (source) customer.
const MERGE_FILLABLE_FIELDS = [
  'name', 'email', 'phone', 'address', 'city', 'notes',
  'lmsUsername', 'lmsPassword', 'source', 'leadStatus', 'leadNote', 'morningClientId',
] as const;

const mergeSchema = z.object({
  sourceId: customerIdSchema,
  overrides: z.record(z.string(), z.string().nullable()).optional(),
});

export const customersRouter = Router();

// All routes require authentication
customersRouter.use(authenticate);

// Lightweight customer search for sales (used by payment-link picker). Returns
// only the fields needed to identify a customer — no addresses, notes, lead
// info, etc. — so sales users don't get access to the full customer object.
customersRouter.get('/lookup', salesOrAbove, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ items: [] });
    const items = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, phone: true, email: true },
      orderBy: { updatedAt: 'desc' },
      take: 12,
    });
    res.json({ items });
  } catch (err) { next(err); }
});

// List customers — admin/manager only (sales users must not access the customer object)
customersRouter.get('/', managerOrAdmin, async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const search = req.query.search as string | undefined;
    const city = req.query.city as string | undefined;
    const sortBy = req.query.sortBy as string | undefined; // 'lastPayment' | 'updatedAt' | undefined
    const leadStatus = req.query.leadStatus as string | undefined;

    const where = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(city && { city }),
      ...(leadStatus && { leadStatus: leadStatus as any }),
      // When sortBy=lastPayment, only return customers who have at least one paid payment
      ...(sortBy === 'lastPayment' && {
        payments: { some: { status: 'paid' } },
      }),
    };

    let customers: any[];
    let total: number;

    if (sortBy === 'lastPayment') {
      // Sort by most recent paid payment using raw SQL (Prisma can't ORDER BY relation field)
      // First get all matching customer IDs sorted by latest payment, then paginate
      const offset = (page - 1) * limit;

      // Build WHERE clause for search
      const searchCondition = search
        ? `AND (c.name ILIKE '%${search.replace(/'/g, "''")}%' OR c.phone LIKE '%${search}%' OR c.email ILIKE '%${search.replace(/'/g, "''")}%')`
        : '';
      const leadStatusCondition = leadStatus ? `AND c.lead_status = '${leadStatus}'` : '';

      const [sortedCustomers, countResult] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(`
          SELECT c.id, MAX(p.paid_at) as latest_payment
          FROM customers c
          INNER JOIN payments p ON p.customer_id = c.id AND p.status = 'paid'
          WHERE c.deleted_at IS NULL
          ${searchCondition}
          ${leadStatusCondition}
          GROUP BY c.id
          ORDER BY latest_payment DESC NULLS LAST
          LIMIT ${limit} OFFSET ${offset}
        `),
        prisma.$queryRawUnsafe<any[]>(`
          SELECT COUNT(DISTINCT c.id)::int as count
          FROM customers c
          INNER JOIN payments p ON p.customer_id = c.id AND p.status = 'paid'
          WHERE c.deleted_at IS NULL
          ${searchCondition}
          ${leadStatusCondition}
        `),
      ]);

      total = Number(countResult[0]?.count ?? 0);
      const orderedIds = sortedCustomers.map((r: any) => r.id);

      if (orderedIds.length === 0) {
        customers = [];
      } else {
        const rawCustomers = await prisma.customer.findMany({
          where: { id: { in: orderedIds } },
          include: {
            _count: { select: { students: true } },
            payments: {
              where: { status: 'paid' },
              orderBy: { paidAt: 'desc' },
              take: 1,
              select: { id: true, amount: true, description: true, paidAt: true },
            },
          },
        });
        // Restore SQL order
        customers = orderedIds.map((id: string) => rawCustomers.find((c: any) => c.id === id)).filter(Boolean);
      }
    } else {
      const orderBy = sortBy === 'updatedAt' ? { updatedAt: 'desc' as const } : { createdAt: 'desc' as const };
      [customers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          include: {
            _count: { select: { students: true } },
            payments: {
              where: { wooOrderId: { not: null }, status: 'paid' },
              select: { id: true },
              take: 1,
            },
          },
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.customer.count({ where }),
      ]);
    }

    const totalPages = Math.ceil(total / limit);
    res.json({
      data: customers,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get customer by ID — admin/manager only (sales users must not access the customer object)
customersRouter.get('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        students: {
          include: {
            registrations: {
              include: {
                cycle: {
                  include: {
                    course: true,
                    branch: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    res.json(customer);
  } catch (error) {
    next(error);
  }
});

// Create customer
customersRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const data = createCustomerSchema.parse(req.body);

    // Check if customer with this phone already exists
    const existingByPhone = await prisma.customer.findUnique({
      where: { phone: data.phone },
      include: {
        _count: { select: { students: true } },
        students: { select: { id: true, name: true } },
      },
    });

    if (existingByPhone) {
      throw new AppError(409, `לקוח עם מספר טלפון ${data.phone} כבר קיים: ${existingByPhone.name}`, {
        existingCustomer: existingByPhone,
      });
    }

    // Check if customer with this email already exists (only if email provided)
    if (data.email) {
      const existingByEmail = await prisma.customer.findUnique({
        where: { email: data.email },
        include: {
          _count: { select: { students: true } },
          students: { select: { id: true, name: true } },
        },
      });

      if (existingByEmail) {
        throw new AppError(409, `לקוח עם כתובת מייל ${data.email} כבר קיים: ${existingByEmail.name}`, {
          existingCustomer: existingByEmail,
        });
      }
    }

    const customer = await prisma.customer.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        address: data.address,
        city: data.city,
        notes: data.notes,
        source: data.source ?? 'manual',
      },
      include: {
        _count: { select: { students: true } },
      },
    });

    // Audit log
    await logAudit({
      userId: req.user?.userId,
      action: 'CREATE',
      entity: 'Customer',
      entityId: customer.id,
      newValue: { name: customer.name, phone: customer.phone, email: customer.email },
      req,
    });

    res.status(201).json(customer);
  } catch (error) {
    next(error);
  }
});

// Update customer
customersRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateCustomerSchema.parse(req.body);

    // Get old value for audit
    const oldCustomer = await prisma.customer.findUnique({ where: { id } });

    // Check duplicate phone (exclude current customer)
    if (data.phone) {
      const phoneConflict = await prisma.customer.findFirst({
        where: { phone: data.phone, id: { not: id } },
      });
      if (phoneConflict) {
        throw new AppError(409, `לקוח עם מספר טלפון ${data.phone} כבר קיים: ${phoneConflict.name}`, {
          existingCustomer: phoneConflict,
        });
      }
    }

    // Check duplicate email (exclude current customer)
    if (data.email) {
      const emailConflict = await prisma.customer.findFirst({
        where: { email: data.email, id: { not: id } },
      });
      if (emailConflict) {
        throw new AppError(409, `לקוח עם כתובת מייל ${data.email} כבר קיים: ${emailConflict.name}`, {
          existingCustomer: emailConflict,
        });
      }
    }

    const customer = await prisma.customer.update({
      where: { id },
      data,
      include: {
        _count: { select: { students: true } },
      },
    });

    // Audit log
    await logAudit({
      userId: req.user?.userId,
      action: 'UPDATE',
      entity: 'Customer',
      entityId: customer.id,
      oldValue: oldCustomer ? { name: oldCustomer.name, phone: oldCustomer.phone, email: oldCustomer.email } : undefined,
      newValue: { name: customer.name, phone: customer.phone, email: customer.email },
      req,
    });

    res.json(customer);
  } catch (error) {
    next(error);
  }
});

// Delete customer
customersRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    // Get old value for audit
    const oldCustomer = await prisma.customer.findUnique({ where: { id } });

    await prisma.customer.delete({
      where: { id },
    });

    // Audit log
    if (oldCustomer) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Customer',
        entityId: id,
        oldValue: { name: oldCustomer.name, phone: oldCustomer.phone, email: oldCustomer.email },
        req,
      });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Count of related records for a customer — used by the merge dialog to show what will move.
customersRouter.get('/:id/relation-counts', managerOrAdmin, async (req, res, next) => {
  try {
    const id = customerIdSchema.parse(req.params.id);
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new AppError(404, 'Customer not found');
    const counts = await countCustomerRelations(id);
    res.json(counts);
  } catch (error) {
    next(error);
  }
});

// Merge a duplicate customer into this one. `:id` is the customer we keep; `sourceId`
// (in the body) is the duplicate that gets absorbed and then deleted.
//
// Behaviour:
//  - All related records (students, payments, quotes, lead appointments, upsell leads,
//    campaign recipients, facebook leads, payment links) are re-pointed to the kept customer.
//  - Scalar fields: the kept customer wins; any field it's missing is filled from the source.
//    `overrides` lets the caller force a specific value per field (e.g. keep the source's name).
//  - The source customer is hard-deleted once everything is moved off it.
customersRouter.post('/:id/merge', managerOrAdmin, async (req, res, next) => {
  try {
    const keepId = customerIdSchema.parse(req.params.id);
    const { sourceId, overrides } = mergeSchema.parse(req.body);

    if (sourceId === keepId) {
      throw new AppError(400, 'לא ניתן למזג לקוח עם עצמו');
    }

    const [keep, source] = await Promise.all([
      prisma.customer.findUnique({ where: { id: keepId } }),
      prisma.customer.findUnique({ where: { id: sourceId } }),
    ]);
    if (!keep) throw new AppError(404, 'לקוח היעד לא נמצא');
    if (!source) throw new AppError(404, 'הלקוח שבחרת למיזוג לא נמצא');

    // Build the merged scalar payload: keeper wins, fill blanks from source, honour overrides.
    const mergedData: Record<string, any> = {};
    for (const field of MERGE_FILLABLE_FIELDS) {
      const override = overrides?.[field];
      if (override !== undefined) {
        const trimmed = override === null ? null : override;
        mergedData[field] = trimmed === '' ? null : trimmed;
      } else {
        const keepVal = (keep as any)[field];
        const sourceVal = (source as any)[field];
        if ((keepVal == null || keepVal === '') && sourceVal != null && sourceVal !== '') {
          mergedData[field] = sourceVal;
        }
      }
    }
    // Never blank out the name.
    if (mergedData.name == null || mergedData.name === '') delete mergedData.name;

    const result = await prisma.$transaction(async (tx) => {
      const [students, quotes, leadAppointments, upsellLeads, campaignRecipients, facebookLeads, payments, paymentLinks] =
        await Promise.all([
          tx.student.updateMany({ where: { customerId: sourceId }, data: { customerId: keepId } }),
          tx.quote.updateMany({ where: { customerId: sourceId }, data: { customerId: keepId } }),
          tx.leadAppointment.updateMany({ where: { customerId: sourceId }, data: { customerId: keepId } }),
          tx.upsellLead.updateMany({ where: { customerId: sourceId }, data: { customerId: keepId } }),
          tx.campaignRecipient.updateMany({ where: { customerId: sourceId }, data: { customerId: keepId } }),
          tx.facebookLead.updateMany({ where: { crmCustomerId: sourceId }, data: { crmCustomerId: keepId } }),
          tx.payment.updateMany({ where: { customerId: sourceId }, data: { customerId: keepId } }),
          tx.paymentLink.updateMany({ where: { customerId: sourceId }, data: { customerId: keepId } }),
        ]);

      // Delete the source first so its unique email/phone are freed before we copy them onto the keeper.
      await tx.customer.delete({ where: { id: sourceId } });

      const updated = Object.keys(mergedData).length
        ? await tx.customer.update({ where: { id: keepId }, data: mergedData })
        : keep;

      return {
        customer: updated,
        moved: {
          students: students.count,
          quotes: quotes.count,
          leadAppointments: leadAppointments.count,
          upsellLeads: upsellLeads.count,
          campaignRecipients: campaignRecipients.count,
          facebookLeads: facebookLeads.count,
          payments: payments.count,
          paymentLinks: paymentLinks.count,
        },
      };
    });

    await logAudit({
      userId: req.user?.userId,
      action: 'MERGE',
      entity: 'Customer',
      entityId: keepId,
      oldValue: { mergedFromId: sourceId, mergedFromName: source.name, mergedFromPhone: source.phone, mergedFromEmail: source.email },
      newValue: { name: result.customer.name, moved: result.moved },
      req,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get customer's students
customersRouter.get('/:id/students', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const students = await prisma.student.findMany({
      where: { customerId: id },
      include: {
        registrations: {
          include: {
            cycle: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
        },
      },
    });

    res.json(students);
  } catch (error) {
    next(error);
  }
});

// Create student for customer
customersRouter.post('/:id/students', managerOrAdmin, async (req, res, next) => {
  try {
    const customerId = uuidSchema.parse(req.params.id);
    
    // Verify customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    
    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    const data = createStudentSchema.omit({ customerId: true }).parse(req.body);

    const student = await prisma.student.create({
      data: {
        name: data.name,
        birthDate: data.birthDate ? new Date(data.birthDate) : null,
        grade: data.grade,
        notes: data.notes,
        customerId,
      },
      include: {
        customer: {
          select: { id: true, name: true },
        },
      },
    });

    res.status(201).json(student);
  } catch (error) {
    next(error);
  }
});
