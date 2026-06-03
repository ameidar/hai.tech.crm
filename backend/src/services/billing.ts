import { prisma } from '../utils/prisma.js';
import { createDocument, previewDocument, createDraftDocument, deleteDraftDocument, DOCUMENT_TYPES, PAYMENT_TYPES } from './morning/documents.js';
import type { CreateDocumentInput, MorningClient, MorningIncomeItem, MorningPaymentItem } from './morning/documents.js';
import { findClientForInstitutionalOrder } from './morning/clients.js';

export type BillingMonth = string; // 'YYYY-MM' — first day of that month, UTC

const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function monthStartDate(month: BillingMonth): Date {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

function monthAfter(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export function monthKey(d: Date): BillingMonth {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

interface RangeBounds {
  start: Date;          // first of monthStart (inclusive)
  endExclusive: Date;   // first of the month AFTER monthEnd (exclusive)
  hebrewLabel: string;  // e.g. "אפריל 2026" or "מרץ–מאי 2026"
}

function rangeBounds(monthStart: BillingMonth, monthEnd: BillingMonth): RangeBounds {
  const start = monthStartDate(monthStart);
  const end = monthStartDate(monthEnd);
  if (end < start) throw new Error('monthEnd must be >= monthStart');
  return {
    start,
    endExclusive: monthAfter(end),
    hebrewLabel: formatHebrewRange(start, end),
  };
}

export function formatHebrewRange(start: Date, end: Date): string {
  const sm = HEBREW_MONTHS[start.getUTCMonth()];
  const sy = start.getUTCFullYear();
  const em = HEBREW_MONTHS[end.getUTCMonth()];
  const ey = end.getUTCFullYear();
  if (start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()) {
    return `${sm} ${sy}`;
  }
  if (sy === ey) return `${sm}–${em} ${sy}`;
  return `${sm} ${sy} – ${em} ${ey}`;
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
 * Compute the per-cycle billing lines for a given institution and range.
 * Looks at billable meetings whose scheduledDate falls anywhere inside the range
 * and applies the cycle's pricing model. Most institutional meetings should be marked
 * completed, but imported/legacy cycles sometimes leave already-held meetings as
 * scheduled; include scheduled meetings whose date has already arrived so a multi-month
 * invoice does not miss them.
 */
async function computeBillingLines(
  institutionalOrderId: string,
  monthStart: BillingMonth,
  monthEnd: BillingMonth,
): Promise<CycleBillingSummary[]> {
  const { start, endExclusive, hebrewLabel } = rangeBounds(monthStart, monthEnd);
  const now = new Date();
  const tomorrowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  const cycles = await prisma.cycle.findMany({
    where: { institutionalOrderId, deletedAt: null },
    include: {
      meetings: {
        where: {
          deletedAt: null,
          AND: [
            { scheduledDate: { gte: start, lt: endExclusive } },
            {
              OR: [
                { status: 'completed' },
                { status: 'scheduled', scheduledDate: { lt: tomorrowUtc } },
              ],
            },
          ],
        },
        select: { id: true },
      },
    },
  });

  const summaries: CycleBillingSummary[] = [];
  for (const cycle of cycles) {
    const completedMeetings = cycle.meetings.length;
    if (completedMeetings === 0) continue;

    // Each cycle type produces a single billing line whose `quantity × unitPrice` totals
    // the gross revenue for the range. The convention differs:
    //   - institutional_fixed:     qty = #meetings,            unitPrice = meetingRevenue
    //   - institutional_per_child: qty = #meetings × students, unitPrice = pricePerStudent
    // The per-student-meeting form for institutional_per_child matches what Morning's UI
    // ends up rendering and gives the recipient line-level granularity to verify.
    let unitPrice = 0;
    let quantity = 0;
    let descriptionDetail = '';
    let studentCount = cycle.studentCount ?? 0;

    if (cycle.type === 'institutional_fixed') {
      unitPrice = Number(cycle.meetingRevenue ?? 0);
      quantity = completedMeetings;
      descriptionDetail = `${completedMeetings} פגישות × ${unitPrice.toLocaleString('he-IL')} ₪`;
    } else if (cycle.type === 'institutional_per_child') {
      const perChild = Number(cycle.pricePerStudent ?? 0);
      unitPrice = perChild;
      quantity = completedMeetings * studentCount;
      // Display the agreed gross (price × 1.18) when prices are stored net, otherwise
      // the per-child price as-is. This keeps the description in the customer's mental
      // model ("9 ילדים × ₪ 60") even when our DB carries the net (₪ 50.85).
      const grossPerChild = cycle.revenueIncludesVat === false
        ? Math.round(perChild * 1.18 * 100) / 100
        : perChild;
      descriptionDetail = `${completedMeetings} פגישות × ${studentCount} ילדים × ${grossPerChild.toLocaleString('he-IL')} ₪`;
    } else {
      // private/trial — should not be linked to institutional order, but skip safely
      continue;
    }

    const total = unitPrice * quantity;
    summaries.push({
      cycleId: cycle.id,
      cycleName: cycle.name,
      cycleType: cycle.type,
      pricePerMeeting: Number(cycle.meetingRevenue ?? 0),
      studentCount,
      completedMeetings,
      unitPrice,
      quantity,
      total,
      description: `${cycle.name} — ${hebrewLabel} (${descriptionDetail})`,
      meetingIds: cycle.meetings.map((m) => m.id),
    });
  }
  return summaries;
}

/**
 * Throw if any non-cancelled period for the same institutional order overlaps the
 * requested range (excluding `excludePeriodId`, used when regenerating an existing
 * draft against its own current row).
 */
async function assertNoOverlap(
  institutionalOrderId: string,
  monthStart: Date,
  monthEnd: Date,
  excludePeriodId?: string,
) {
  const overlap = await prisma.billingPeriod.findFirst({
    where: {
      institutionalOrderId,
      status: { not: 'cancelled' },
      monthStart: { lte: monthEnd },
      monthEnd: { gte: monthStart },
      ...(excludePeriodId ? { NOT: { id: excludePeriodId } } : {}),
    },
    select: { id: true, monthStart: true, monthEnd: true, status: true, morningDocNumber: true },
  });
  if (overlap) {
    const label = formatHebrewRange(overlap.monthStart, overlap.monthEnd);
    const docPart = overlap.morningDocNumber ? ` (חשבונית #${overlap.morningDocNumber})` : '';
    const err: any = new Error(`overlap with existing ${overlap.status} period ${label}${docPart}`);
    err.status = 409;
    err.code = 'BILLING_PERIOD_OVERLAP';
    throw err;
  }
}

/**
 * Generate (or upsert) a draft billing period for an institution + range.
 * If a draft already exists with the exact same range, its lines are replaced with
 * fresh computed data — except lines whose admin has flagged `descriptionCustomized`,
 * whose text is preserved (only quantity/unitPrice/total refresh).
 * If a non-draft period exists at the same range, refuses to regenerate.
 */
export async function generateBillingPeriod(
  institutionalOrderId: string,
  monthStart: BillingMonth,
  monthEnd: BillingMonth,
  generatedById?: string,
) {
  const { start } = rangeBounds(monthStart, monthEnd);
  const end = monthStartDate(monthEnd);

  const existing = await prisma.billingPeriod.findUnique({
    where: { institutionalOrderId_monthStart_monthEnd: { institutionalOrderId, monthStart: start, monthEnd: end } },
    include: { lines: true },
  });
  const canReviveCancelledDraft = Boolean(
    existing &&
    existing.status === 'cancelled' &&
    !existing.issuedAt &&
    !existing.morningDocNumber &&
    !existing.morningDocId
  );
  if (existing && existing.status !== 'draft' && !canReviveCancelledDraft) {
    throw new Error(`Billing period already ${existing.status} — cannot regenerate`);
  }

  await assertNoOverlap(institutionalOrderId, start, end, existing?.id);

  const summaries = await computeBillingLines(institutionalOrderId, monthStart, monthEnd);
  const totalAmount = summaries.reduce((s, l) => s + l.total, 0);

  // Preserve any per-line description that the admin marked as customized — match by cycleId.
  const customizedByCycle = new Map<string, string>();
  if (existing) {
    for (const line of existing.lines) {
      if (line.descriptionCustomized && line.cycleId) {
        customizedByCycle.set(line.cycleId, line.description);
      }
    }
  }

  if (existing) {
    await prisma.billingPeriodLine.deleteMany({ where: { billingPeriodId: existing.id } });
    const period = await prisma.billingPeriod.update({
      where: { id: existing.id },
      data: {
        status: 'draft',
        totalAmount,
        generatedAt: new Date(),
        generatedById,
        morningDraftId: null,
        sentAt: null,
        sentChannel: null,
        sentToEmail: null,
        sentToPhone: null,
        lines: {
          create: summaries.map((s, i) => ({
            cycleId: s.cycleId,
            description: customizedByCycle.get(s.cycleId) ?? s.description,
            descriptionCustomized: customizedByCycle.has(s.cycleId),
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
      monthStart: start,
      monthEnd: end,
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
 * Generate single-month drafts for ALL active institutions for the given month.
 * Skips any that already exist (in any status) so the cron is idempotent. Multi-month
 * ranges are admin-initiated only — the cron stays month-by-month.
 */
export async function generateAllBillingPeriodsForMonth(month: BillingMonth, generatedById?: string) {
  const orders = await prisma.institutionalOrder.findMany({
    where: { status: { in: ['active', 'completed'] } },
    select: { id: true },
  });

  const results = { created: 0, skipped: 0, empty: 0, errors: [] as string[] };
  for (const order of orders) {
    try {
      const start = monthStartDate(month);
      const exists = await prisma.billingPeriod.findFirst({
        where: {
          institutionalOrderId: order.id,
          monthStart: { lte: start },
          monthEnd: { gte: start },
        },
      });
      if (exists) { results.skipped++; continue; }

      const summaries = await computeBillingLines(order.id, month, month);
      if (summaries.length === 0) { results.empty++; continue; }

      await generateBillingPeriod(order.id, month, month, generatedById);
      results.created++;
    } catch (err: any) {
      results.errors.push(`${order.id}: ${err.message}`);
    }
  }
  return results;
}

/**
 * Resolve which Morning client to use for an institutional order. Returns the client object
 * to put on the document plus, if we discovered the linkage just now (rather than reusing a
 * cached `morningClientId`), the Morning client UUID so the caller can persist it back to
 * the order. Persisting only happens on `issue` — preview is read-only.
 */
async function resolveMorningClient(
  order: {
    id: string;
    orderName: string | null;
    branch?: { name: string | null } | null;
    taxId: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    address: string | null;
    city: string | null;
    zip: string | null;
    payingBody: string | null;
    morningClientId: string | null;
  }
): Promise<{ client: MorningClient; discoveredId: string | null }> {
  const payingBodyName = order.payingBody?.trim() || null;

  // 1. If a paying body is configured, it is the customer-facing "לכבוד" name
  // for institutional billing. Do not send only Morning's stored client id in this
  // case: Morning would render the client-directory name (often the internal
  // branch/order name) instead of the payer name from CRM. Sending explicit
  // client details keeps the document addressee controlled by CRM without
  // changing the institutional order name.
  if (payingBodyName) {
    return {
      client: {
        name: payingBodyName,
        taxId: order.taxId || undefined,
        emails: order.contactEmail ? [order.contactEmail] : undefined,
        phone: order.contactPhone || undefined,
        address: order.address || undefined,
        city: order.city || undefined,
        zip: order.zip || undefined,
      },
      discoveredId: null,
    };
  }

  // 2. Already linked — trust it when no paying body overrides the addressee.
  if (order.morningClientId) {
    return { client: { id: order.morningClientId }, discoveredId: null };
  }

  // 3. Try to discover an existing Morning customer by taxId / email / payingBody / orderName.
  try {
    const match = await findClientForInstitutionalOrder({
      taxId: order.taxId,
      contactEmail: order.contactEmail,
      orderName: order.orderName,
      payingBody: order.payingBody,
    });
    if (match) {
      console.log(`[billing] Linked institutional order ${order.id} → Morning client ${match.client.id} (matched by ${match.matchedBy})`);
      return { client: { id: match.client.id }, discoveredId: match.client.id };
    }
  } catch (err: any) {
    // If the Morning search itself fails, fall through to upsert — no worse than the old behavior.
    console.warn(`[billing] Morning client search failed for order ${order.id}:`, err.message || err);
  }

  // 4. Fallback: send full client details with `add: true` so Morning upserts.
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
  return { client, discoveredId: null };
}

/**
 * Build the Morning createDocument payload from a billing period (draft state).
 * Also returns the Morning client UUID we discovered on-the-fly (if any), so the caller
 * can persist it back to the institutional order on a successful issue.
 */
async function buildMorningPayload(billingPeriodId: string): Promise<{
  payload: CreateDocumentInput;
  discoveredMorningClientId: string | null;
}> {
  const period = await prisma.billingPeriod.findUnique({
    where: { id: billingPeriodId },
    include: {
      institutionalOrder: { include: { branch: true } },
      lines: {
        orderBy: { sortOrder: 'asc' },
        include: { cycle: { select: { revenueIncludesVat: true } } },
      },
    },
  });
  if (!period) throw new Error('Billing period not found');

  const { client, discoveredId } = await resolveMorningClient(period.institutionalOrder);

  // Per-line vatType: derive from the source cycle's `revenueIncludesVat` flag.
  // Morning vatType per income line: 0 = price excludes VAT (Morning adds 18% on top —
  // the default for institutional clients that quote net prices); 2 = price already
  // includes VAT (Morning extracts it, so the line total stays price × qty). Manual lines
  // without a cycle fall back to 0. `unitPrice` is stored as the agreed per-unit price
  // (gross when revenueIncludesVat), so it is sent as-is.
  const lineVatTypes = period.lines.map((l) =>
    l.cycle?.revenueIncludesVat === true ? 2 : 0
  );
  const allSameVatType = lineVatTypes.every((v) => v === lineVatTypes[0]);
  const documentVatType: 0 | 2 = (lineVatTypes[0] ?? 0);

  const income: MorningIncomeItem[] = period.lines.map((l, i) => ({
    description: l.description,
    quantity: Number(l.quantity),
    price: Number(l.unitPrice),
    currency: 'ILS',
    // Always set the per-line vatType — it is what actually controls VAT handling. With
    // vatType 2 Morning treats the price as VAT-inclusive (total = price × qty); omitting
    // it makes Morning add 18% on top even when the document-level vatType is 2.
    vatType: lineVatTypes[i] as 0 | 2,
  }));

  // Morning's PDF always shows the VAT line in the totals block, but we want a plain
  // sentence on the document itself so the recipient sees "המחירים אינם כוללים מע״מ"
  // (or "כוללים מע״מ") next to the lines, not just in the math at the bottom.
  const effectiveVatType = allSameVatType ? documentVatType : 0;
  const vatLabel = effectiveVatType === 2
    ? 'המחירים בחשבון זה כוללים מע״מ.'
    : 'המחירים בחשבון זה אינם כוללים מע״מ. סה״כ כולל מע״מ מצוין בסיכום.';
  const description = period.documentTitle?.trim() || undefined;
  const notes = period.notes?.trim();
  const remarks = [vatLabel, notes].filter(Boolean).join('\n');

  return {
    payload: {
      type: DOCUMENT_TYPES.PROFORMA,
      lang: 'he',
      currency: 'ILS',
      vatType: effectiveVatType,
      client,
      income,
      remarks,
      ...(description ? { description } : {}),
    },
    discoveredMorningClientId: discoveredId,
  };
}

export async function previewBillingPeriod(billingPeriodId: string) {
  const { payload } = await buildMorningPayload(billingPeriodId);
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

  const { payload, discoveredMorningClientId } = await buildMorningPayload(billingPeriodId);
  const document = await createDocument(payload);

  // Snapshot meetings included in this issued invoice — used for drift detection later.
  const summaries = await computeBillingLines(
    period.institutionalOrderId,
    monthKey(period.monthStart),
    monthKey(period.monthEnd),
  );
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
    // Cache the Morning client linkage on the institutional order so future invoices
    // skip the lookup and never accidentally create a duplicate Morning customer.
    if (discoveredMorningClientId) {
      await tx.institutionalOrder.update({
        where: { id: period.institutionalOrderId },
        data: { morningClientId: discoveredMorningClientId },
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

/**
 * Push the billing period to Morning as a **draft** (lives in Morning's drafts area,
 * editable from their UI, not a real document yet). Use this when the user needs to
 * backdate beyond the few-day window the API allows on `createDocument` — they'll
 * finalize the document inside Morning's UI with the date they need, then come back
 * here and call `markBillingPeriodIssuedManually` with the resulting doc number.
 *
 * Idempotent-ish: if the period already has a `morningDraftId`, that draft is deleted
 * and replaced (so the draft on Morning's side always reflects the latest line edits).
 */
export async function sendBillingPeriodAsDraft(billingPeriodId: string) {
  const period = await prisma.billingPeriod.findUnique({ where: { id: billingPeriodId } });
  if (!period) throw new Error('Billing period not found');
  if (period.status === 'issued') throw new Error('Already issued — use mark-issued-manually instead');
  if (period.status === 'cancelled') throw new Error('Period is cancelled');

  const { payload, discoveredMorningClientId } = await buildMorningPayload(billingPeriodId);

  // Replace any prior draft so Morning's drafts area never accumulates stale copies.
  if (period.morningDraftId) {
    try { await deleteDraftDocument(period.morningDraftId); } catch { /* ignore — draft might already be gone */ }
  }

  const draft = await createDraftDocument(payload);

  return prisma.$transaction(async (tx) => {
    if (discoveredMorningClientId) {
      await tx.institutionalOrder.update({
        where: { id: period.institutionalOrderId },
        data: { morningClientId: discoveredMorningClientId },
      });
    }
    return tx.billingPeriod.update({
      where: { id: billingPeriodId },
      data: { morningDraftId: draft.id },
      include: { lines: true, institutionalOrder: true },
    });
  });
}

/**
 * Manually mark a billing period as issued — the user finalized the document inside
 * Morning's UI (typically because they needed to backdate) and is now syncing the
 * document number back into our system. Captures the meeting snapshot for drift
 * detection and clears the morningDraftId since the draft has graduated.
 */
export interface ManualIssueInput {
  morningDocNumber: number;
  morningDocId?: string | null;
  morningDocUrl?: string | null;
  morningDocType?: number | null;     // defaults to 300 (proforma)
  issuedAt?: Date;                    // defaults to now()
}

export async function markBillingPeriodIssuedManually(
  billingPeriodId: string,
  input: ManualIssueInput,
  issuedById?: string
) {
  const period = await prisma.billingPeriod.findUnique({
    where: { id: billingPeriodId },
    include: { lines: true },
  });
  if (!period) throw new Error('Billing period not found');
  if (period.status === 'issued') throw new Error('Billing period already issued');
  if (period.status === 'cancelled') throw new Error('Billing period is cancelled');

  const issuedAt = input.issuedAt ?? new Date();
  const dueDate = new Date(issuedAt);
  dueDate.setUTCDate(dueDate.getUTCDate() + 8);

  // Snapshot meetings — same as auto-issue path.
  const summaries = await computeBillingLines(
    period.institutionalOrderId,
    monthKey(period.monthStart),
    monthKey(period.monthEnd),
  );
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

  return prisma.$transaction(async (tx) => {
    if (snapshot.length > 0) {
      await tx.billingPeriodMeeting.createMany({ data: snapshot, skipDuplicates: true });
    }
    return tx.billingPeriod.update({
      where: { id: billingPeriodId },
      data: {
        status: 'issued',
        issuedAt,
        issuedById,
        dueDate,
        morningDocId: input.morningDocId ?? null,
        morningDocNumber: input.morningDocNumber,
        morningDocUrl: input.morningDocUrl ?? null,
        morningDocType: input.morningDocType ?? 300,
        morningDraftId: null, // draft has graduated; clear the pointer
      },
      include: { lines: true, institutionalOrder: true },
    });
  });
}

/**
 * Find completed meetings for the period's institution + range that are NOT in
 * the issued snapshot. Used to flag "we billed and then someone added more
 * billable activity for the same range." Drafts have no snapshot, so this is
 * only meaningful for issued periods.
 */
export async function detectDrift(billingPeriodId: string) {
  const period = await prisma.billingPeriod.findUnique({
    where: { id: billingPeriodId },
    include: { meetings: { select: { meetingId: true } } },
  });
  if (!period) throw new Error('Billing period not found');

  const snapshotIds = new Set(period.meetings.map((m) => m.meetingId));
  const { start, endExclusive } = rangeBounds(monthKey(period.monthStart), monthKey(period.monthEnd));

  const currentMeetings = await prisma.meeting.findMany({
    where: {
      cycle: { institutionalOrderId: period.institutionalOrderId, deletedAt: null },
      status: 'completed',
      scheduledDate: { gte: start, lt: endExclusive },
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

/** A single receipt line for a tax-invoice/receipt (320) document. */
export interface TaxReceiptPaymentInput {
  date: string;   // YYYY-MM-DD
  type: number;   // see PAYMENT_TYPES
  amount: number; // gross amount received
}

/** Best-effort map a free-text payment method to a Morning payment type. */
function methodToMorningType(method?: string | null): number {
  const m = (method || '').toLowerCase();
  if (/מזומן|cash/.test(m)) return PAYMENT_TYPES.CASH;
  if (/צ['׳]?ק|שיק|check|cheque/.test(m)) return PAYMENT_TYPES.CHEQUE;
  if (/אשראי|כרטיס|credit|card/.test(m)) return PAYMENT_TYPES.CREDIT_CARD;
  if (/העברה|בנק|transfer|wire|bank/.test(m)) return PAYMENT_TYPES.BANK_TRANSFER;
  if (/paypal|פייפל/.test(m)) return PAYMENT_TYPES.PAYPAL;
  if (/ביט|bit|פייבוקס|paybox|app/.test(m)) return PAYMENT_TYPES.PAYMENT_APP;
  return PAYMENT_TYPES.BANK_TRANSFER; // institutional default
}

/** Seed receipt lines from the payments already recorded on the period. */
async function defaultTaxReceiptPayments(billingPeriodId: string): Promise<TaxReceiptPaymentInput[]> {
  const payments = await prisma.billingPayment.findMany({
    where: { billingPeriodId },
    orderBy: { paidAt: 'asc' },
  });
  return payments.map((p) => ({
    date: new Date(p.paidAt).toISOString().slice(0, 10),
    type: methodToMorningType(p.method),
    amount: Number(p.amount),
  }));
}

function toMorningPaymentArray(payments: TaxReceiptPaymentInput[]): MorningPaymentItem[] {
  return payments.map((p) => ({
    date: p.date,
    type: p.type,
    price: p.amount,
    currency: 'ILS',
  }));
}

/** Build a 320 (tax invoice + receipt) payload from a period, attaching receipt lines. */
async function buildTaxReceiptPayload(billingPeriodId: string, payments?: TaxReceiptPaymentInput[]) {
  const built = await buildMorningPayload(billingPeriodId);
  built.payload.type = DOCUMENT_TYPES.TAX_INVOICE_RECEIPT; // 320
  const pays = payments ?? await defaultTaxReceiptPayments(billingPeriodId);
  built.payload.payment = toMorningPaymentArray(pays);
  return built;
}

/** Render a 320 preview PDF (base64) without creating anything in Morning. */
export async function previewTaxInvoice(billingPeriodId: string, payments?: TaxReceiptPaymentInput[]) {
  const { payload } = await buildTaxReceiptPayload(billingPeriodId, payments);
  return previewDocument(payload);
}

/**
 * Issue a binding tax invoice + receipt (חשבונית מס/קבלה, type 320) in Morning, alongside
 * the proforma. The proforma stays linked on the period; this only adds tax-invoice fields.
 * Receipt lines default to the payments recorded on the period, but can be overridden.
 */
export async function issueTaxInvoice(
  billingPeriodId: string,
  issuedById?: string,
  payments?: TaxReceiptPaymentInput[],
) {
  const period = await prisma.billingPeriod.findUnique({ where: { id: billingPeriodId } });
  if (!period) throw new Error('Billing period not found');
  if (period.status !== 'issued') throw new Error('Proforma must be issued first');
  if (period.taxInvoiceId) throw new Error('Tax invoice already issued for this period');

  const { payload, discoveredMorningClientId } = await buildTaxReceiptPayload(billingPeriodId, payments);
  const document = await createDocument(payload);

  return prisma.$transaction(async (tx) => {
    if (discoveredMorningClientId) {
      await tx.institutionalOrder.update({
        where: { id: period.institutionalOrderId },
        data: { morningClientId: discoveredMorningClientId },
      });
    }
    return tx.billingPeriod.update({
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
  });
}
