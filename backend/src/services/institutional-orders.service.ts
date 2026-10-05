// Institutional orders — shared business logic for the internal CRM route
// (/api/institutional-orders) and the v1 ops API (/api/v1/institutional-orders).
// Moved verbatim from routes/institutional-orders.ts so validation and behavior stay identical.

import type { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { paginationSchema } from '../types/schemas.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';

export const orderSchema = z.object({
  branchId: z.string().optional().nullable(),
  payingBodyId: z.string().optional().nullable(),
  orderName: z.string().optional().nullable(),
  orderNumber: z.string().optional().nullable(),
  orderDate: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  pricePerMeeting: z.coerce.number().positive().optional().nullable(),
  estimatedMeetings: z.coerce.number().int().optional().nullable(),
  estimatedTotal: z.coerce.number().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
  status: z.enum(['draft', 'active', 'completed', 'cancelled']).optional(),
  fireberryStatus: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  totalAmount: z.coerce.number().optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  invoiceLink: z.string().optional().nullable(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional().nullable(),
  paidAmount: z.coerce.number().optional().nullable(),
  payingBody: z.string().optional().nullable(),
  paymentTermsDays: z.coerce.number().int().min(0).optional(),
  followUpDate: z.string().optional().nullable(),
  salesperson: z.string().optional().nullable(),
  orderType: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  // Billing fields — needed for issuing monthly proforma to Morning
  taxId: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
});

// New institutional orders must be tied to a branch AND a paying body. Existing orders
// without either are left untouched (the DB columns stay nullable) — this only blocks
// creating new ones, so legacy rows stay editable and can be completed gradually.
export const createOrderSchema = orderSchema.extend({
  branchId: z.string().min(1, 'חובה לבחור סניף בעת יצירת הזמנה מוסדית'),
  payingBodyId: z.string().min(1, 'חובה לבחור גוף משלם בעת יצירת הזמנה מוסדית'),
});


export interface InstitutionalOrderListQuery {
  page?: unknown;
  limit?: unknown;
  status?: string;
  withCycles?: string;
  withRelevantCycles?: string;
  forBilling?: string;
  search?: string;
}

export async function listInstitutionalOrders(query: InstitutionalOrderListQuery) {
    const { page, limit } = paginationSchema.parse(query);
    const status = query.status;
    const withCycles = query.withCycles === 'true';
    const withRelevantCycles = query.withRelevantCycles === 'true';
    const forBilling = query.forBilling === 'true';
    const search = query.search?.trim();

    // Server-side search so the list isn't limited to the current page's rows. Matches the
    // same fields the UI exposes: order name/number, contact, paying body, and branch name.
    const searchFilter = search
      ? {
          OR: [
            { orderName: { contains: search, mode: 'insensitive' as const } },
            { orderNumber: { contains: search, mode: 'insensitive' as const } },
            { contactName: { contains: search, mode: 'insensitive' as const } },
            { contactPhone: { contains: search, mode: 'insensitive' as const } },
            { payingBody: { contains: search, mode: 'insensitive' as const } },
            { salesperson: { contains: search, mode: 'insensitive' as const } },
            { branch: { is: { name: { contains: search, mode: 'insensitive' as const } } } },
          ],
        }
      : {};

    const linkedCyclesFilter = withCycles
      ? {
          cycles: {
            some: {
              deletedAt: null,
            },
          },
        }
      : {};

    // For billing flows we only want institutions that still have a billing-relevant cycle:
    // either an active cycle, or one that was touched in the last 12 months (so just-frozen
    // / just-completed cycles stay billable while ancient ones drop off).
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const relevantCyclesFilter = withRelevantCycles
      ? {
          cycles: {
            some: {
              deletedAt: null,
              OR: [
                { status: 'active' as const },
                { updatedAt: { gte: twelveMonthsAgo } },
              ],
            },
          },
        }
      : {};

    const where = {
      ...(status && { status: status as any }),
      ...(forBilling && !status ? { status: { in: ['active', 'completed'] as const } } : {}),
      ...linkedCyclesFilter,
      ...relevantCyclesFilter,
      ...searchFilter,
    };

    const [orders, total] = await Promise.all([
      prisma.institutionalOrder.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, city: true, type: true } },
          payingBodyRef: { select: { id: true, name: true, taxId: true, morningClientId: true, isComplete: true } },
          _count: { select: { cycles: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.institutionalOrder.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data: orders,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
}

export async function getInstitutionalOrder(id: string) {
    const order = await prisma.institutionalOrder.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true, city: true, type: true } },
        payingBodyRef: { select: { id: true, name: true, taxId: true, morningClientId: true, isComplete: true } },
        cycles: {
          where: { deletedAt: null },
          select: { id: true, name: true, status: true, startDate: true },
          orderBy: { startDate: 'desc' },
        },
        _count: { select: { cycles: true } },
      },
    });
    if (!order) throw new AppError(404, 'Institutional order not found');
    return order;
}

/**
 * Create an institutional order. `body` is validated with createOrderSchema
 * (branchId + payingBodyId are required on create).
 */
export async function createInstitutionalOrder(body: unknown, req?: Request) {
    const data = createOrderSchema.parse(body);
    const order = await prisma.institutionalOrder.create({
      data: {
        branchId: data.branchId,
        payingBodyId: data.payingBodyId,
        orderName: data.orderName ?? null,
        orderNumber: data.orderNumber ?? null,
        orderDate: data.orderDate ? new Date(data.orderDate) : null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        pricePerMeeting: data.pricePerMeeting ?? null,
        estimatedMeetings: data.estimatedMeetings ?? null,
        estimatedTotal: data.estimatedTotal ?? null,
        contactName: data.contactName ?? null,
        contactPhone: data.contactPhone ?? null,
        contactEmail: data.contactEmail || null,
        status: data.status || 'draft',
        fireberryStatus: data.fireberryStatus ?? null,
        notes: data.notes ?? null,
        totalAmount: data.totalAmount ?? null,
        invoiceLink: data.invoiceLink ?? null,
        payingBody: data.payingBody ?? null,
        paymentTermsDays: data.paymentTermsDays ?? 30,
        followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
        salesperson: data.salesperson ?? null,
        orderType: data.orderType ?? null,
        createdBy: data.createdBy ?? null,
        taxId: data.taxId ?? null,
        address: data.address ?? null,
        city: data.city ?? null,
        zip: data.zip ?? null,
      },
      include: {
        branch: { select: { id: true, name: true, city: true, type: true } },
        payingBodyRef: { select: { id: true, name: true, taxId: true, morningClientId: true, isComplete: true } },
        _count: { select: { cycles: true } },
      },
    });
    await logAudit({
      action: 'CREATE',
      entity: 'InstitutionalOrder',
      entityId: order.id,
      newValue: auditOrder(order),
      req,
    });
    return order;
}

/** Update an institutional order (all fields optional so legacy rows stay editable). */
export async function updateInstitutionalOrder(id: string, body: unknown, req?: Request) {
    const data = orderSchema.partial().parse(body);
    const existing = await prisma.institutionalOrder.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Institutional order not found');

    const order = await prisma.institutionalOrder.update({
      where: { id },
      data: {
        ...(data.branchId !== undefined && { branchId: data.branchId || null }),
        ...(data.payingBodyId !== undefined && { payingBodyId: data.payingBodyId || null }),
        ...(data.orderName !== undefined && { orderName: data.orderName }),
        ...(data.orderNumber !== undefined && { orderNumber: data.orderNumber }),
        ...(data.orderDate !== undefined && { orderDate: data.orderDate ? new Date(data.orderDate) : null }),
        ...(data.startDate !== undefined && { startDate: data.startDate ? new Date(data.startDate) : null }),
        ...(data.endDate !== undefined && { endDate: data.endDate ? new Date(data.endDate) : null }),
        ...(data.pricePerMeeting !== undefined && { pricePerMeeting: data.pricePerMeeting }),
        ...(data.estimatedMeetings !== undefined && { estimatedMeetings: data.estimatedMeetings }),
        ...(data.estimatedTotal !== undefined && { estimatedTotal: data.estimatedTotal }),
        ...(data.contactName !== undefined && { contactName: data.contactName }),
        ...(data.contactPhone !== undefined && { contactPhone: data.contactPhone }),
        ...(data.contactEmail !== undefined && { contactEmail: data.contactEmail || null }),
        ...(data.status && { status: data.status }),
        ...(data.fireberryStatus !== undefined && { fireberryStatus: data.fireberryStatus }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.totalAmount !== undefined && { totalAmount: data.totalAmount }),
        ...(data.invoiceNumber !== undefined && { invoiceNumber: data.invoiceNumber }),
        ...(data.invoiceLink !== undefined && { invoiceLink: data.invoiceLink }),
        ...(data.paymentStatus !== undefined && { paymentStatus: data.paymentStatus }),
        ...(data.paidAmount !== undefined && { paidAmount: data.paidAmount }),
        ...(data.payingBody !== undefined && { payingBody: data.payingBody }),
        ...(data.paymentTermsDays !== undefined && { paymentTermsDays: data.paymentTermsDays }),
        ...(data.followUpDate !== undefined && { followUpDate: data.followUpDate ? new Date(data.followUpDate) : null }),
        ...(data.salesperson !== undefined && { salesperson: data.salesperson }),
        ...(data.orderType !== undefined && { orderType: data.orderType }),
        ...(data.createdBy !== undefined && { createdBy: data.createdBy }),
        ...(data.taxId !== undefined && { taxId: data.taxId }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.city !== undefined && { city: data.city }),
        ...(data.zip !== undefined && { zip: data.zip }),
      },
      include: {
        branch: { select: { id: true, name: true, city: true, type: true } },
        payingBodyRef: { select: { id: true, name: true, taxId: true, morningClientId: true, isComplete: true } },
        _count: { select: { cycles: true } },
      },
    });
    await logUpdateAudit({
      entity: 'InstitutionalOrder',
      entityId: id,
      oldRecord: auditOrder(existing),
      newRecord: auditOrder(order),
      req,
    });
    return order;
}

/** Plain, JSON-safe snapshot of the order fields that matter for the audit trail. */
function auditOrder(o: Record<string, any>) {
  const fields = [
    'branchId', 'payingBodyId', 'orderName', 'orderNumber', 'orderDate', 'startDate', 'endDate',
    'pricePerMeeting', 'estimatedMeetings', 'estimatedTotal', 'contactName', 'contactPhone',
    'contactEmail', 'status', 'fireberryStatus', 'notes', 'totalAmount', 'invoiceNumber',
    'invoiceLink', 'paymentStatus', 'paidAmount', 'payingBody', 'paymentTermsDays', 'followUpDate',
    'salesperson', 'orderType', 'taxId', 'address', 'city', 'zip',
  ];
  const out: Record<string, any> = {};
  for (const f of fields) {
    const v = o[f];
    if (v === undefined) continue;
    out[f] = v instanceof Date ? v.toISOString() : (v !== null && typeof v === 'object' ? v.toString() : v);
  }
  return out;
}
