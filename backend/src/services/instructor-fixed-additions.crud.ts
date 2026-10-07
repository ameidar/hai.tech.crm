// Instructor fixed monthly additions (תוספות קבועות) — CRUD shared by the internal route
// (/api/instructors/:id/fixed-additions) and the v1 ops API
// (/api/v1/instructors/:id/fixed-additions). Moved verbatim from routes/instructors.ts.

import type { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';
import { actorUserId } from '../utils/request-actor.js';
import { MONTH_REGEX, monthToDate, dateToMonth } from './instructor-fixed-additions.js';

const monthField = z.string().regex(MONTH_REGEX, 'חודש חייב להיות בפורמט YYYY-MM');

const fixedAdditionBaseSchema = z.object({
  description: z.string().trim().min(1, 'תיאור הוא שדה חובה').max(200),
  amount: z.coerce.number().positive('הסכום חייב להיות גדול מ-0').max(1_000_000),
  isNet: z.boolean().default(true),
  startMonth: monthField,
  endMonth: monthField.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const endNotBeforeStart = (d: { startMonth?: string; endMonth?: string | null }) =>
  !d.startMonth || !d.endMonth || d.endMonth >= d.startMonth;
const endBeforeStartError = { message: 'חודש סיום חייב להיות זהה או מאוחר מחודש ההתחלה', path: ['endMonth'] };

export const createFixedAdditionSchema = fixedAdditionBaseSchema.refine(endNotBeforeStart, endBeforeStartError);
export const updateFixedAdditionSchema = fixedAdditionBaseSchema.partial().refine(endNotBeforeStart, endBeforeStartError);

type FixedAdditionRow = {
  id: string;
  instructorId: string;
  description: string;
  amount: { toString(): string };
  isNet: boolean;
  startMonth: Date;
  endMonth: Date | null;
  notes: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const serializeFixedAddition = (a: FixedAdditionRow) => {
  const currentMonth = dateToMonth(new Date());
  const endMonth = a.endMonth ? dateToMonth(a.endMonth) : null;
  const startMonth = dateToMonth(a.startMonth);
  return {
    id: a.id,
    instructorId: a.instructorId,
    description: a.description,
    amount: Number(a.amount.toString()),
    isNet: a.isNet,
    startMonth,
    endMonth,
    notes: a.notes,
    createdById: a.createdById,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    status: endMonth && endMonth < currentMonth ? 'ended' : startMonth > currentMonth ? 'future' : 'active',
  };
};

const auditFixedAddition = (a: FixedAdditionRow) => ({
  instructorId: a.instructorId,
  description: a.description,
  amount: Number(a.amount.toString()),
  isNet: a.isNet,
  startMonth: dateToMonth(a.startMonth),
  endMonth: a.endMonth ? dateToMonth(a.endMonth) : null,
  notes: a.notes,
});

const findFixedAdditionOr404 = async (instructorId: string, additionId: string) => {
  const existing = await prisma.instructorFixedAddition.findFirst({
    where: { id: additionId, instructorId, deletedAt: null },
  });
  if (!existing) throw new AppError(404, 'Fixed addition not found');
  return existing;
};

export async function listFixedAdditions(instructorId: string) {
  const additions = await prisma.instructorFixedAddition.findMany({
    where: { instructorId, deletedAt: null },
    orderBy: [{ startMonth: 'desc' }, { createdAt: 'desc' }],
  });
  return additions.map(serializeFixedAddition);
}

export async function createFixedAddition(instructorId: string, input: unknown, req?: Request) {
  const data = createFixedAdditionSchema.parse(input);

  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId }, select: { id: true } });
  if (!instructor) throw new AppError(404, 'Instructor not found');

  const created = await prisma.instructorFixedAddition.create({
    data: {
      instructorId,
      description: data.description,
      amount: data.amount,
      isNet: data.isNet,
      startMonth: monthToDate(data.startMonth),
      endMonth: data.endMonth ? monthToDate(data.endMonth) : null,
      notes: data.notes || null,
      createdById: actorUserId(req) ?? null,
    },
  });

  await logAudit({
    action: 'CREATE',
    entity: 'InstructorFixedAddition',
    entityId: created.id,
    newValue: auditFixedAddition(created),
    req,
  });

  return serializeFixedAddition(created);
}

// Update (also used to "end" an addition by setting endMonth)
export async function updateFixedAddition(instructorId: string, additionId: string, input: unknown, req?: Request) {
  const data = updateFixedAdditionSchema.parse(input);
  const existing = await findFixedAdditionOr404(instructorId, additionId);

  const startMonth = data.startMonth ?? dateToMonth(existing.startMonth);
  const endMonth = data.endMonth !== undefined
    ? data.endMonth
    : (existing.endMonth ? dateToMonth(existing.endMonth) : null);
  if (endMonth && endMonth < startMonth) {
    throw new AppError(400, 'חודש סיום חייב להיות זהה או מאוחר מחודש ההתחלה');
  }

  const updated = await prisma.instructorFixedAddition.update({
    where: { id: additionId },
    data: {
      ...(data.description !== undefined && { description: data.description }),
      ...(data.amount !== undefined && { amount: data.amount }),
      ...(data.isNet !== undefined && { isNet: data.isNet }),
      ...(data.startMonth !== undefined && { startMonth: monthToDate(data.startMonth) }),
      ...(data.endMonth !== undefined && { endMonth: data.endMonth ? monthToDate(data.endMonth) : null }),
      ...(data.notes !== undefined && { notes: data.notes || null }),
    },
  });

  await logUpdateAudit({
    entity: 'InstructorFixedAddition',
    entityId: additionId,
    oldRecord: auditFixedAddition(existing),
    newRecord: auditFixedAddition(updated),
    req,
  });

  return serializeFixedAddition(updated);
}

// Soft delete
export async function deleteFixedAddition(instructorId: string, additionId: string, req?: Request) {
  const existing = await findFixedAdditionOr404(instructorId, additionId);

  await prisma.instructorFixedAddition.update({
    where: { id: additionId },
    data: { deletedAt: new Date(), deletedBy: actorUserId(req) ?? null },
  });

  await logAudit({
    action: 'DELETE',
    entity: 'InstructorFixedAddition',
    entityId: additionId,
    oldValue: auditFixedAddition(existing),
    req,
  });
}
