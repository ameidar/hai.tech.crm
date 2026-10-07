// Paying bodies (גוף משלם) — shared business logic for the internal CRM route
// (/api/paying-bodies) and the v1 ops API (/api/v1/paying-bodies).
// Moved verbatim from routes/paying-bodies.ts. No Morning side effects here: the internal
// create/update don't touch Morning either (Morning sync is a separate explicit action).

import type { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { paginationSchema } from '../types/schemas.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';

const trimmed = (max = 255) => z.string().trim().min(1).max(max);

// Required on create (decided with Inna): name, taxId (ח.פ or ת.ז), contactName, email.
// Phone + address fields are optional. morningClientId links to an existing Morning client.
export const createSchema = z.object({
  name: trimmed(),
  taxId: trimmed(50),
  contactName: trimmed(),
  email: z.string().trim().email(),
  phone: z.string().trim().max(50).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  zip: z.string().trim().max(20).optional().nullable(),
  morningClientId: z.string().trim().max(120).optional().nullable(),
});

// On update every field is optional so legacy incomplete rows can be completed gradually.
export const updateSchema = z.object({
  name: trimmed().optional(),
  taxId: z.string().trim().max(50).optional().nullable(),
  contactName: z.string().trim().max(255).optional().nullable(),
  email: z.union([z.string().trim().email(), z.literal('')]).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  zip: z.string().trim().max(20).optional().nullable(),
  morningClientId: z.string().trim().max(120).optional().nullable(),
});

export const isComplete = (b: { name?: string | null; taxId?: string | null; contactName?: string | null; email?: string | null }) =>
  !!(b.name && b.taxId && b.contactName && b.email);

export interface PayingBodyListQuery {
  page?: unknown;
  limit?: unknown;
  q?: string;
  incomplete?: string;
}

// Optional `q` filters by name or taxId (substring); `incomplete=true` → only incomplete rows.
export async function listPayingBodies(query: PayingBodyListQuery) {
  const { page, limit } = paginationSchema.parse(query);
  const q = query.q?.trim();
  const onlyIncomplete = query.incomplete === 'true';

  const where = {
    ...(q && {
      OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { taxId: { contains: q, mode: 'insensitive' as const } },
      ],
    }),
    ...(onlyIncomplete && { isComplete: false }),
  };

  const [items, total] = await Promise.all([
    prisma.payingBody.findMany({
      where,
      include: { _count: { select: { institutionalOrders: true } } },
      orderBy: [{ isComplete: 'asc' }, { name: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.payingBody.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);
  return {
    data: items,
    pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getPayingBody(id: string) {
  const body = await prisma.payingBody.findUnique({
    where: { id },
    include: { _count: { select: { institutionalOrders: true } } },
  });
  if (!body) throw new AppError(404, 'Paying body not found');
  return body;
}

// Create — name, taxId, contactName, email are required (createSchema).
export async function createPayingBody(input: unknown, req?: Request) {
  const data = createSchema.parse(input);
  const body = await prisma.payingBody.create({
    data: { ...data, isComplete: isComplete(data) },
  });
  await logAudit({ action: 'CREATE', entity: 'PayingBody', entityId: body.id, newValue: { name: body.name, taxId: body.taxId }, req });
  return body;
}

// Update — recompute isComplete from the merged record so legacy rows flip to complete
// once all required fields are filled.
export async function updatePayingBody(id: string, input: unknown, req?: Request) {
  const data = updateSchema.parse(input);

  const existing = await prisma.payingBody.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Paying body not found');

  const merged = {
    name: data.name ?? existing.name,
    taxId: data.taxId ?? existing.taxId,
    contactName: data.contactName ?? existing.contactName,
    email: (data.email === '' ? null : data.email) ?? existing.email,
  };

  const body = await prisma.payingBody.update({
    where: { id },
    data: {
      ...data,
      email: data.email === '' ? null : data.email,
      isComplete: isComplete(merged),
    },
  });

  await logUpdateAudit({ entity: 'PayingBody', entityId: id, oldRecord: existing, newRecord: body, req });
  return body;
}
