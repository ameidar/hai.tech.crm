import { prisma } from '../utils/prisma.js';
import { createDocument, previewDocument, DOCUMENT_TYPES } from './morning/documents.js';
import type { CreateDocumentInput, MorningClient, MorningIncomeItem } from './morning/documents.js';

export type BillingMonth = string; // 'YYYY-MM'

const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function monthBounds(month: BillingMonth) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1)); // exclusive
  return { start, end, hebrewLabel: `${HEBREW_MONTHS[m - 1]} ${y}` };
}

interface CycleBillingSummary {
  cycleId: string;
  cycleName: string;
  cycleType: string;
  pricePerMeeting: number;
  studentCount: number;
  completedMeetings: number;
  unitPrice: number;
  quantity: number;
  total: number;
  description: string;
  meetingIds: string[];
}

/**
 * Compute the per-cycle billing lines for a given institution and month.
 * Looks at completed meetings in that month and applies the cycle's pricing model.
 */
async function computeBillingLines(institutionalOrderId: string, month: BillingMonth): Promise<CycleBillingSummary[]> {
  const { start, end, hebrewLabel } = monthBounds(month);

  const cycles = await prisma.cycle.findMany({
    where: { institutionalOrderId, deletedAt: null },
    include: {
      meetings: {
        where: {
          status: 'completed',
          scheduledDate: { gte: start, lt: end },
          deletedAt: null,
        },
        select: { id: true },
      },
    },
  });

  const summaries: CycleBillingSummary[] = [];
  for (const cycle of cycles) {
    const completedMeetings = cycle.meetings.length;
    if (completedMeetings === 0) continue;

    let unitPrice = 0;
    let descriptionDetail = '';

    if (cycle.type === 'institutional_fixed') {
      unitPrice = Number(cycle.meetingRevenue ?? 0);
      descriptionDetail = `${completedMeetings} פגישות × ${unitPrice.toLocaleString('he-IL')} ₪`;
    } else if (cycle.type === 'institutional_per_child') {
      const perChild = Number(cycle.pricePerStudent ?? 0);
      const studentCount = cycle.studentCount ?? 0;
      unitPrice = perChild * studentCount;
      descriptionDetail = `${completedMeetings} פגישות × ${studentCount} ילדים × ${perChild.toLocaleString('he-IL')} ₪`;
    } else {
      // private/trial — should not be linked to institutional order, but skip safely
      continue;
    }

    const total = unitPrice * completedMeetings;
    summaries.push({
      cycleId: cycle.id,
      cycleName: cycle.name,
      cycleType: cycle.type,
      pricePerMeeting: Number(cycle.meetingRevenue ?? 0),
      studentCount: cycle.studentCount ?? 0,
      completedMeetings,
      unitPrice,
      quantity: completedMeetings,
      total,
      description: `${cycle.name} — ${hebrewLabel} (${descriptionDetail})`,
      meetingIds: cycle.meetings.map((m) => m.id),
    });
  }
  return summaries;
}

/**
 * Generate (or upsert) a draft billing period for an institution and month.
 * If a period already exists with status=draft, replace its lines with fresh
 * data from the source-of-truth meetings. If status is `issued` or `cancelled`,
 * refuses to regenerate.
 */
export async function generateBillingPeriod(institutionalOrderId: string, month: BillingMonth, generatedById?: string) {
  const { start } = monthBounds(month);

  const existing = await prisma.billingPeriod.findUnique({
    where: { institutionalOrderId_month: { institutionalOrderId, month: start } },
  });
  if (existing && existing.status !== 'draft') {
    throw new Error(`Billing period already ${existing.status} — cannot regenerate`);
  }

  const summaries = await computeBillingLines(institutionalOrderId, month);
  const totalAmount = summaries.reduce((s, l) => s + l.total, 0);

  if (existing) {
    await prisma.billingPeriodLine.deleteMany({ where: { billingPeriodId: existing.id } });
    const period = await prisma.billingPeriod.update({
      where: { id: existing.id },
      data: {
        totalAmount,
        generatedAt: new Date(),
        generatedById,
        lines: {
          create: summaries.map((s, i) => ({
            cycleId: s.cycleId,
            description: s.description,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
            total: s.total,
            sortOrder: i,
          })),
        },
      },
      include: { lines: true },
    });
    return period;
  }

  const period = await prisma.billingPeriod.create({
    data: {
      institutionalOrderId,
      month: start,
      status: 'draft',
      totalAmount,
      generatedById,
      lines: {
        create: summaries.map((s, i) => ({
          cycleId: s.cycleId,
          description: s.description,
          quantity: s.quantity,
          unitPrice: s.unitPrice,
          total: s.total,
          sortOrder: i,
        })),
      },
    },
    include: { lines: true },
  });
  return period;
}

/**
 * Generate drafts for ALL active institutions for the given month. Skips any
 * that already exist (in any status) so the cron is idempotent.
 */
export async function generateAllBillingPeriodsForMonth(month: BillingMonth, generatedById?: string) {
  const { start } = monthBounds(month);
  const orders = await prisma.institutionalOrder.findMany({
    where: { status: { in: ['active', 'completed'] } },
    select: { id: true },
  });

  const results = { created: 0, skipped: 0, empty: 0, errors: [] as string[] };
  for (const order of orders) {
    try {
      const exists = await prisma.billingPeriod.findUnique({
        where: { institutionalOrderId_month: { institutionalOrderId: order.id, month: start } },
      });
      if (exists) { results.skipped++; continue; }

      const summaries = await computeBillingLines(order.id, month);
      if (summaries.length === 0) { results.empty++; continue; }

      await generateBillingPeriod(order.id, month, generatedById);
      results.created++;
    } catch (err: any) {
      results.errors.push(`${order.id}: ${err.message}`);
    }
  }
  return results;
}

/**
 * Build the Morning createDocument payload from a billing period (draft state).
 */
async function buildMorningPayload(billingPeriodId: string): Promise<CreateDocumentInput> {
  const period = await prisma.billingPeriod.findUnique({
    where: { id: billingPeriodId },
    include: {
      institutionalOrder: { include: { branch: true } },
      lines: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!period) throw new Error('Billing period not found');

  const order = period.institutionalOrder;
  const client: MorningClient = {
    name: order.orderName || order.branch?.name || 'מוסד',
    taxId: order.taxId || undefined,
    emails: order.contactEmail ? [order.contactEmail] : undefined,
    phone: order.contactPhone || undefined,
    address: order.address || undefined,
    city: order.city || undefined,
    zip: order.zip || undefined,
    add: true,
  };

  const income: MorningIncomeItem[] = period.lines.map((l) => ({
    description: l.description,
    quantity: Number(l.quantity),
    price: Number(l.unitPrice),
    currency: 'ILS',
  }));

  return {
    type: DOCUMENT_TYPES.PROFORMA,
    lang: 'he',
    currency: 'ILS',
    vatType: 0, // Morning: 0=default (price excludes VAT, 18% added on top); 1=exempt; 2=included
    client,
    income,
    remarks: period.notes || undefined,
  };
}

export async function previewBillingPeriod(billingPeriodId: string) {
  const payload = await buildMorningPayload(billingPeriodId);
  return previewDocument(payload);
}

export async function issueBillingPeriod(billingPeriodId: string, issuedById?: string) {
  const period = await prisma.billingPeriod.findUnique({
    where: { id: billingPeriodId },
    include: { lines: true },
  });
  if (!period) throw new Error('Billing period not found');
  if (period.status === 'issued') throw new Error('Billing period already issued');
  if (period.status === 'cancelled') throw new Error('Billing period is cancelled');

  const payload = await buildMorningPayload(billingPeriodId);
  const document = await createDocument(payload);

  // Snapshot meetings included in this issued invoice — used for drift detection later.
  const month = monthKey(period.month);
  const summaries = await computeBillingLines(period.institutionalOrderId, month);
  const cycleToLineId = new Map<string, string>();
  for (const line of period.lines) {
    if (line.cycleId) cycleToLineId.set(line.cycleId, line.id);
  }
  const snapshot: { billingPeriodId: string; lineId: string | null; meetingId: string }[] = [];
  for (const s of summaries) {
    const lineId = cycleToLineId.get(s.cycleId) ?? null;
    for (const meetingId of s.meetingIds) {
      snapshot.push({ billingPeriodId, lineId, meetingId });
    }
  }

  const issuedAt = new Date();
  const dueDate = new Date(issuedAt);
  dueDate.setUTCDate(dueDate.getUTCDate() + 8); // matches Morning's default proforma due date

  return prisma.$transaction(async (tx) => {
    if (snapshot.length > 0) {
      await tx.billingPeriodMeeting.createMany({
        data: snapshot,
        skipDuplicates: true,
      });
    }
    return tx.billingPeriod.update({
      where: { id: billingPeriodId },
      data: {
        status: 'issued',
        issuedAt,
        issuedById,
        dueDate,
        morningDocId: document.id,
        morningDocNumber: document.number,
        morningDocUrl: document.url?.he || document.url?.origin || null,
        morningDocType: document.type,
      },
      include: { lines: true, institutionalOrder: true },
    });
  });
}

function monthKey(d: Date): BillingMonth {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Find completed meetings for the period's institution + month that are NOT in
 * the issued snapshot. Used to flag "we billed and then someone added more
 * billable activity for the same month." Drafts have no snapshot, so this is
 * only meaningful for issued periods.
 */
export async function detectDrift(billingPeriodId: string) {
  const period = await prisma.billingPeriod.findUnique({
    where: { id: billingPeriodId },
    include: { meetings: { select: { meetingId: true } } },
  });
  if (!period) throw new Error('Billing period not found');

  const snapshotIds = new Set(period.meetings.map((m) => m.meetingId));
  const month = monthKey(period.month);
  const { start, end } = monthBounds(month);

  const currentMeetings = await prisma.meeting.findMany({
    where: {
      cycle: { institutionalOrderId: period.institutionalOrderId, deletedAt: null },
      status: 'completed',
      scheduledDate: { gte: start, lt: end },
      deletedAt: null,
    },
    select: {
      id: true,
      scheduledDate: true,
      startTime: true,
      revenue: true,
      instructorPayment: true,
      cycle: { select: { id: true, name: true, type: true } },
      instructor: { select: { id: true, name: true } },
    },
    orderBy: { scheduledDate: 'asc' },
  });

  const newSinceIssue = currentMeetings.filter((m) => !snapshotIds.has(m.id));
  const removedSinceIssue: string[] = [];
  for (const id of snapshotIds) {
    if (!currentMeetings.find((m) => m.id === id)) removedSinceIssue.push(id);
  }

  return {
    issuedAt: period.issuedAt,
    snapshotCount: snapshotIds.size,
    currentCount: currentMeetings.length,
    newSinceIssue,        // meetings completed/added after issue → potentially under-billed
    removedSinceIssue,    // meetings that were in snapshot but no longer match → over-billed
  };
}

/**
 * Append a payment record and recompute the period's paymentStatus + paidAmount.
 * Treats sums >= totalAmount (with 1 agora tolerance) as fully paid.
 */
export async function addPayment(
  billingPeriodId: string,
  input: { amount: number; method?: string | null; notes?: string | null; paidAt?: string | Date | null; recordedById?: string },
) {
  const period = await prisma.billingPeriod.findUnique({ where: { id: billingPeriodId } });
  if (!period) throw new Error('Billing period not found');

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

  return prisma.$transaction(async (tx) => {
    await tx.billingPayment.create({
      data: {
        billingPeriodId,
        amount: input.amount,
        method: input.method || null,
        notes: input.notes || null,
        paidAt,
        recordedById: input.recordedById || null,
      },
    });
    const sums = await tx.billingPayment.aggregate({
      where: { billingPeriodId },
      _sum: { amount: true },
    });
    const paidAmount = Number(sums._sum.amount ?? 0);
    // Total includes 18% VAT — periods store NET, but the client owes gross.
    const totalGross = Number(period.totalAmount) * 1.18;
    const isFullyPaid = paidAmount + 0.01 >= totalGross;
    const paymentStatus = isFullyPaid ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

    return tx.billingPeriod.update({
      where: { id: billingPeriodId },
      data: {
        paidAmount,
        paymentStatus,
        paidAt: isFullyPaid ? paidAt : null,
      },
      include: { payments: { orderBy: { paidAt: 'desc' } }, lines: true },
    });
  });
}

export async function deletePayment(billingPeriodId: string, paymentId: string) {
  const payment = await prisma.billingPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.billingPeriodId !== billingPeriodId) throw new Error('Payment not found');

  return prisma.$transaction(async (tx) => {
    await tx.billingPayment.delete({ where: { id: paymentId } });
    const period = await tx.billingPeriod.findUnique({ where: { id: billingPeriodId } });
    if (!period) throw new Error('Billing period not found');
    const sums = await tx.billingPayment.aggregate({
      where: { billingPeriodId },
      _sum: { amount: true },
    });
    const paidAmount = Number(sums._sum.amount ?? 0);
    const totalGross = Number(period.totalAmount) * 1.18;
    const isFullyPaid = paidAmount + 0.01 >= totalGross;
    const paymentStatus = isFullyPaid ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';
    return tx.billingPeriod.update({
      where: { id: billingPeriodId },
      data: { paidAmount, paymentStatus, paidAt: isFullyPaid ? period.paidAt : null },
      include: { payments: { orderBy: { paidAt: 'desc' } } },
    });
  });
}

export async function markBillingSent(
  billingPeriodId: string,
  input: { channel: string; toEmail?: string | null; toPhone?: string | null },
) {
  return prisma.billingPeriod.update({
    where: { id: billingPeriodId },
    data: {
      sentAt: new Date(),
      sentChannel: input.channel,
      sentToEmail: input.toEmail || null,
      sentToPhone: input.toPhone || null,
    },
  });
}

/**
 * Issue a binding tax invoice (חשבונית מס, type 305) in Morning, alongside the proforma.
 * The proforma stays linked on the period; this only adds tax-invoice fields.
 */
export async function issueTaxInvoice(billingPeriodId: string, issuedById?: string) {
  const period = await prisma.billingPeriod.findUnique({ where: { id: billingPeriodId } });
  if (!period) throw new Error('Billing period not found');
  if (period.status !== 'issued') throw new Error('Proforma must be issued first');
  if (period.taxInvoiceId) throw new Error('Tax invoice already issued for this period');

  const payload = await buildMorningPayload(billingPeriodId);
  payload.type = 305; // חשבונית מס
  const document = await createDocument(payload);

  return prisma.billingPeriod.update({
    where: { id: billingPeriodId },
    data: {
      taxInvoiceId: document.id,
      taxInvoiceNumber: document.number,
      taxInvoiceUrl: document.url?.he || document.url?.origin || null,
      taxInvoiceIssuedAt: new Date(),
      taxInvoiceIssuedById: issuedById,
    },
    include: { lines: true, institutionalOrder: true, payments: true },
  });
}
