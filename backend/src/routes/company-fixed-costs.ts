import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { MONTH_REGEX, monthToDate, dateToMonth } from '../services/instructor-fixed-additions.js';

// Company-level fixed monthly costs (e.g. salaried staff) shown in the dashboard forecast.
export const companyFixedCostsRouter = Router();
companyFixedCostsRouter.use(authenticate);

const monthSchema = z.string().regex(MONTH_REGEX, 'חודש בפורמט YYYY-MM');

const baseSchema = z.object({
  name: z.string().trim().min(1, 'חובה לציין שם'),
  category: z.string().trim().min(1).optional(),
  amount: z.number().positive('הסכום חייב להיות חיובי'),
  startMonth: monthSchema,
  endMonth: monthSchema.nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  monthOverrides: z.record(monthSchema, z.number().nonnegative()).nullable().optional(),
});

const createSchema = baseSchema.refine(
  (d) => !d.endMonth || d.endMonth >= d.startMonth,
  { message: 'חודש הסיום חייב להיות אחרי חודש ההתחלה', path: ['endMonth'] },
);
const updateSchema = baseSchema.partial();

function serialize(c: any) {
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    amount: Number(c.amount),
    startMonth: dateToMonth(c.startMonth),
    endMonth: c.endMonth ? dateToMonth(c.endMonth) : null,
    monthOverrides: c.monthOverrides ?? null,
    notes: c.notes,
  };
}

companyFixedCostsRouter.get('/', managerOrAdmin, async (_req, res, next) => {
  try {
    const rows = await prisma.companyFixedCost.findMany({
      where: { deletedAt: null },
      orderBy: [{ startMonth: 'asc' }, { name: 'asc' }],
    });
    res.json(rows.map(serialize));
  } catch (error) {
    next(error);
  }
});

companyFixedCostsRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const row = await prisma.companyFixedCost.create({
      data: {
        name: data.name,
        category: data.category ?? 'staff',
        amount: data.amount,
        startMonth: monthToDate(data.startMonth),
        endMonth: data.endMonth ? monthToDate(data.endMonth) : null,
        notes: data.notes ?? null,
        ...(data.monthOverrides ? { monthOverrides: data.monthOverrides } : {}),
      },
    });
    await logAudit({ action: 'CREATE', entity: 'CompanyFixedCost', entityId: row.id, newValue: serialize(row), req });
    res.status(201).json(serialize(row));
  } catch (error) {
    next(error);
  }
});

companyFixedCostsRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const existing = await prisma.companyFixedCost.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'הוצאה קבועה לא נמצאה' });

    const startMonth = data.startMonth ?? dateToMonth(existing.startMonth);
    const endMonth = data.endMonth !== undefined
      ? data.endMonth
      : existing.endMonth ? dateToMonth(existing.endMonth) : null;
    if (endMonth && endMonth < startMonth) {
      return res.status(400).json({ error: 'חודש הסיום חייב להיות אחרי חודש ההתחלה' });
    }

    const row = await prisma.companyFixedCost.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.monthOverrides !== undefined && { monthOverrides: data.monthOverrides ?? Prisma.JsonNull }),
        startMonth: monthToDate(startMonth),
        endMonth: endMonth ? monthToDate(endMonth) : null,
      },
    });
    await logAudit({ action: 'UPDATE', entity: 'CompanyFixedCost', entityId: row.id, oldValue: serialize(existing), newValue: serialize(row), req });
    res.json(serialize(row));
  } catch (error) {
    next(error);
  }
});

companyFixedCostsRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const existing = await prisma.companyFixedCost.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'הוצאה קבועה לא נמצאה' });
    await prisma.companyFixedCost.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    await logAudit({ action: 'DELETE', entity: 'CompanyFixedCost', entityId: existing.id, oldValue: serialize(existing), req });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
