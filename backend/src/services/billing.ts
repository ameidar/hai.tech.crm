import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { createDocument, previewDocument, createDraftDocument, deleteDraftDocument, getMorningDocument, searchMorningDocuments, closeMorningDocument, DOCUMENT_TYPES, PAYMENT_TYPES } from './morning/documents.js';
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

interface RegistrationWindow {
  registrationDate: Date;
  cancellationDate: Date | null;
  status: string;
  deletedAt: Date | null;
}

/**
 * Was this child billable for the given calendar month?
 *
 * Per-child billing must reflect the *historical* roster of each month, not the cycle's
 * current student count — otherwise cancelling a child in May retroactively lowers April's
 * (and every prior month's) invoice. We reconstruct the month's roster from each
 * registration's own dates instead of the mutable `cycle.studentCount`.
 *
 * Policy (decided by Ami): a child cancelled mid-month is still counted *in full* for that
 * month — they were active for part of it. So a child counts for month M when they were
 * registered on/before the month ended AND were not already cancelled before it began.
 */
function isChildActiveInMonth(reg: RegistrationWindow, monthStart: Date, monthEndExclusive: Date): boolean {
  if (reg.deletedAt) return false;
  // Registered only after this month → not yet enrolled.
  if (reg.registrationDate >= monthEndExclusive) return false;
  if (reg.cancellationDate) {
    // Cancelled before the month started → not active. Cancelled during/after → counts fully.
    return reg.cancellationDate >= monthStart;
  }
  // No cancellation date recorded: if the status nonetheless says cancelled we cannot know
  // which month it ended, so exclude it (matches the live active-count used elsewhere).
  if (reg.status === 'cancelled' || reg.status === 'pending_cancellation') return false;
  return true;
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
        select: { id: true, scheduledDate: true },
      },
      registrations: {
        select: { registrationDate: true, cancellationDate: true, status: true, deletedAt: true },
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

      // Reconstruct the per-child count for each month from the historical roster rather
      // than the cycle's mutable studentCount, so a later cancellation never rewrites a
      // past month's invoice. A period usually spans one month; multi-month ranges sum
      // each month's (meetings × that month's child count).
      const meetingsByMonth = new Map<string, number>();
      for (const m of cycle.meetings) {
        const k = monthKey(m.scheduledDate);
        meetingsByMonth.set(k, (meetingsByMonth.get(k) ?? 0) + 1);
      }
      const monthBreakdown = [...meetingsByMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mk, meetings]) => {
          const mStart = monthStartDate(mk);
          const mEnd = monthAfter(mStart);
          const children = cycle.registrations.filter((r) => isChildActiveInMonth(r, mStart, mEnd)).length;
          return { meetings, children };
        });

      quantity = monthBreakdown.reduce((sum, b) => sum + b.meetings * b.children, 0);
      const distinctCounts = new Set(monthBreakdown.map((b) => b.children));
      // Snapshot a single representative count: exact for the common single-month case,
      // an average for the rare multi-month range with a roster that changed mid-range.
      studentCount = distinctCounts.size === 1
        ? (monthBreakdown[0]?.children ?? 0)
        : (completedMeetings > 0 ? Math.round(quantity / completedMeetings) : 0);

      // Display the agreed gross (price × 1.18) when prices are stored net, otherwise
      // the per-child price as-is. This keeps the description in the customer's mental
      // model ("9 ילדים × ₪ 60") even when our DB carries the net (₪ 50.85).
      const grossPerChild = cycle.revenueIncludesVat === false
        ? Math.round(perChild * 1.18 * 100) / 100
        : perChild;
      const countsPart = distinctCounts.size === 1
        ? `${completedMeetings} פגישות × ${studentCount} ילדים`
        : monthBreakdown.map((b) => `${b.meetings} פגישות × ${b.children} ילדים`).join(' + ');
      descriptionDetail = `${countsPart} × ${grossPerChild.toLocaleString('he-IL')} ₪`;
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
            studentCount: s.cycleType === 'institutional_per_child' ? s.studentCount : null,
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
          studentCount: s.cycleType === 'institutional_per_child' ? s.studentCount : null,
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

/** Where to cache the resolved Morning client id after a successful issue. */
type MorningClientCacheTarget = { kind: 'payingBody' | 'order'; id: string } | null;

interface ResolvedMorningClient {
  client: MorningClient;
  // After issue, persist the resolved Morning client UUID here so future documents bill
  // by id and never create a duplicate Morning customer. null = nothing to cache (already
  // linked by id, or a free-text addressee we don't want to pin).
  cacheTarget: MorningClientCacheTarget;
  // Id we already know now (from a search match). When null, the caller reads the created
  // document's `client.id` (the id Morning assigned to a freshly upserted `add:true` client).
  discoveredId: string | null;
}

/**
 * Resolve which Morning client to use for an institutional order.
 *
 * Source of truth is the linked **PayingBody** (גוף משלם):
 *  - already linked to a Morning client (`morningClientId`) → bill by that id, zero dupes;
 *  - linked PayingBody not yet in Morning → send its full details with `add:true` so Morning
 *    creates the client, and ask the caller to persist the assigned id back onto the PayingBody.
 *
 * Orders with no linked PayingBody (legacy, pre-migration) fall back to the old free-text
 * behavior unchanged, so they keep working during the transition.
 *
 * Persisting only happens on `issue` — preview is read-only.
 */
export async function resolveMorningClient(
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
    payingBodyRef?: {
      id: string;
      name: string;
      taxId: string | null;
      email: string | null;
      phone: string | null;
      address: string | null;
      city: string | null;
      zip: string | null;
      morningClientId: string | null;
    } | null;
  }
): Promise<ResolvedMorningClient> {
  const pb = order.payingBodyRef;

  // ── Linked PayingBody = the source of truth ──────────────────────────────
  if (pb) {
    // Already linked to a Morning client — bill by id, never upsert, never duplicate.
    if (pb.morningClientId) {
      return { client: { id: pb.morningClientId }, cacheTarget: null, discoveredId: null };
    }
    // Not yet in Morning — send full details with `add:true`. Morning creates the client
    // and returns its id on the document; the caller pins it onto PayingBody.morningClientId.
    return {
      client: {
        name: pb.name,
        taxId: pb.taxId || undefined,
        emails: pb.email ? [pb.email] : undefined,
        phone: pb.phone || undefined,
        address: pb.address || undefined,
        city: pb.city || undefined,
        zip: pb.zip || undefined,
        add: true,
      },
      cacheTarget: { kind: 'payingBody', id: pb.id },
      discoveredId: null,
    };
  }

  // ── Legacy path (no linked PayingBody): unchanged free-text behavior ──────
  const payingBodyName = order.payingBody?.trim() || null;

  // 1. Free-text paying body is the customer-facing "לכבוד" name. Send explicit details
  // (with `add:true`) so the addressee stays controlled by CRM and the document attaches
  // to a Morning client rather than floating.
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
        add: true,
      },
      cacheTarget: null,
      discoveredId: null,
    };
  }

  // 2. Already linked on the order — trust it.
  if (order.morningClientId) {
    return { client: { id: order.morningClientId }, cacheTarget: null, discoveredId: null };
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
      return { client: { id: match.client.id }, cacheTarget: { kind: 'order', id: order.id }, discoveredId: match.client.id };
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
  return { client, cacheTarget: null, discoveredId: null };
}

/**
 * Persist a resolved Morning client id onto its cache target (PayingBody or order) inside a
 * transaction, so future documents bill by id. No-op when there is nothing to cache.
 */
async function cacheMorningClientId(
  tx: Prisma.TransactionClient,
  cacheTarget: MorningClientCacheTarget,
  resolvedId: string | null,
): Promise<void> {
  if (!cacheTarget || !resolvedId) return;
  if (cacheTarget.kind === 'payingBody') {
    await tx.payingBody.update({ where: { id: cacheTarget.id }, data: { morningClientId: resolvedId } });
  } else {
    await tx.institutionalOrder.update({ where: { id: cacheTarget.id }, data: { morningClientId: resolvedId } });
  }
}

/**
 * Gate: refuse to issue a billing document while the linked PayingBody is incomplete.
 * Issuing with a half-filled payer is exactly what creates broken/duplicate Morning clients,
 * so we force completion once at the billing gate. Legacy orders with no linked PayingBody are
 * grandfathered and stay billable. Preview is read-only and is intentionally NOT gated.
 */
async function assertPayingBodyComplete(billingPeriodId: string): Promise<void> {
  const period = await prisma.billingPeriod.findUnique({
    where: { id: billingPeriodId },
    select: {
      institutionalOrder: {
        select: { payingBodyRef: { select: { name: true, isComplete: true } } },
      },
    },
  });
  const pb = period?.institutionalOrder?.payingBodyRef;
  if (!pb) return; // legacy order without a linked paying body — grandfathered
  if (!pb.isComplete) {
    throw new Error(
      `הגוף המשלם "${pb.name}" אינו שלם — יש להשלים שם, ח.פ/ת.ז, איש קשר ומייל לפני הפקת מסמך חיוב.`,
    );
  }
}

/**
 * Read the client (לכבוד) name exactly as it appears on a Morning document. Best-effort:
 * a lookup failure must never block issuing/linking, so we return null and fall back to the
 * order name. The monthly-accounts list snapshots this onto the period so the displayed
 * institution name matches Morning.
 */
async function fetchMorningDocClientName(docId: string): Promise<string | null> {
  try {
    const doc = await getMorningDocument(docId);
    return doc.client?.name?.trim() || null;
  } catch (err: any) {
    console.warn(`[billing] could not read Morning client name for doc ${docId}:`, err?.message || err);
    return null;
  }
}

const VAT_RATE = 0.18;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Frozen copy of the proforma (חשבון עסקה) at issue time, stored on
 * BillingPeriod.proformaSnapshot. Every downstream document (320/305/400) is rebuilt from
 * this so its amount can never silently diverge from the proforma.
 *
 * `income`/`vatType`/`remarks`/`description` are present only when we issued the proforma
 * ourselves and therefore know the exact lines — those are reused verbatim. For legacy
 * periods (issued before this field existed) or proformas issued by hand in Morning, only
 * `grossTotal` is reconstructed from the Morning document, and it is used purely as a guard
 * so a downstream document with a different total is refused rather than silently issued.
 */
export interface ProformaSnapshot {
  income?: MorningIncomeItem[];
  vatType?: 0 | 2;
  remarks?: string;
  description?: string;
  grossTotal: number; // gross incl VAT — matches Morning's "סה״כ לתשלום"
}

/** Gross total (incl VAT) of a set of income lines, honoring each line's vatType. */
export function grossFromIncome(income: MorningIncomeItem[]): number {
  let total = 0;
  for (const l of income) {
    const net = Number(l.price) * Number(l.quantity);
    // vatType 2 = price already includes VAT; 1 = exempt (no VAT); 0/undefined = add VAT on top.
    const gross = l.vatType === 2 || l.vatType === 1 ? net : net * (1 + VAT_RATE);
    total += gross;
  }
  return round2(total);
}

/** Build the proforma snapshot from the payload we just sent, preferring Morning's own gross. */
export function buildProformaSnapshot(payload: CreateDocumentInput, morningAmount?: number): ProformaSnapshot {
  return {
    income: payload.income,
    vatType: (payload.vatType as 0 | 2),
    remarks: payload.remarks,
    description: payload.description,
    grossTotal: typeof morningAmount === 'number' && morningAmount > 0
      ? round2(morningAmount)
      : grossFromIncome(payload.income),
  };
}

/**
 * Return the period's proforma snapshot, reconstructing + persisting it from the Morning
 * proforma document when missing (legacy / manual-Morning periods). Returns null only when
 * there is nothing to anchor to (e.g. not issued yet, or Morning lookup failed) — callers
 * then skip the amount guard rather than block.
 */
async function ensureProformaSnapshot(billingPeriodId: string): Promise<ProformaSnapshot | null> {
  const period = await prisma.billingPeriod.findUnique({
    where: { id: billingPeriodId },
    select: { proformaSnapshot: true, morningDocId: true },
  });
  if (!period) return null;
  if (period.proformaSnapshot) return period.proformaSnapshot as unknown as ProformaSnapshot;
  if (!period.morningDocId) return null; // draft / never issued — nothing to reconstruct from

  try {
    const doc = await getMorningDocument(period.morningDocId);
    const gross = typeof doc.amount === 'number' && doc.amount > 0
      ? round2(doc.amount)
      : (doc.income ? grossFromIncome(doc.income) : 0);
    if (!(gross > 0)) return null;
    const snap: ProformaSnapshot = { grossTotal: gross };
    await prisma.billingPeriod.update({
      where: { id: billingPeriodId },
      data: { proformaSnapshot: snap as unknown as object },
    });
    return snap;
  } catch (err) {
    console.warn('[billing] ensureProformaSnapshot: Morning lookup failed', err);
    return null;
  }
}

/** Overwrite a downstream payload's amount-bearing fields with the proforma's frozen lines. */
export function applyProformaSnapshot(payload: CreateDocumentInput, snap: ProformaSnapshot): void {
  if (!snap.income || snap.income.length === 0) return; // legacy snapshot holds only grossTotal
  payload.income = snap.income.map((l) => ({ ...l }));
  if (snap.vatType !== undefined) payload.vatType = snap.vatType;
  if (snap.remarks !== undefined) payload.remarks = snap.remarks;
  if (snap.description !== undefined) payload.description = snap.description;
  else delete payload.description;
}

/**
 * Hard invariant: a downstream document's gross must equal the issued proforma's gross.
 * This is what guarantees "every חשבונית מס/קבלה equals the חשבון עסקה before it". When we
 * have no proforma anchor (snap === null) we cannot verify, so we don't block.
 */
export function assertProformaAmountMatch(
  payload: CreateDocumentInput,
  snap: ProformaSnapshot | null,
  docLabel: string,
): void {
  if (!snap) return;
  const gross = grossFromIncome(payload.income);
  if (Math.abs(gross - snap.grossTotal) > 0.02) {
    throw new Error(
      `${docLabel} amount (₪${gross.toFixed(2)}) does not match the issued חשבון עסקה (₪${snap.grossTotal.toFixed(2)}). ` +
      `Refusing to issue a document with a different total than the proforma. ` +
      `If the proforma itself is wrong, cancel and re-issue it — the tax invoice/receipt must equal it.`,
    );
  }
}

/**
 * Build the Morning createDocument payload from a billing period (draft state).
 * Also returns the Morning client UUID we discovered on-the-fly (if any), so the caller
 * can persist it back to the institutional order on a successful issue.
 */
async function buildMorningPayload(billingPeriodId: string, documentDate?: string): Promise<{
  payload: CreateDocumentInput;
  cacheTarget: MorningClientCacheTarget;
  discoveredId: string | null;
}> {
  const period = await prisma.billingPeriod.findUnique({
    where: { id: billingPeriodId },
    include: {
      institutionalOrder: {
        include: {
          branch: true,
          payingBodyRef: {
            select: {
              id: true, name: true, taxId: true, email: true,
              phone: true, address: true, city: true, zip: true, morningClientId: true,
            },
          },
        },
      },
      lines: {
        orderBy: { sortOrder: 'asc' },
        include: { cycle: { select: { revenueIncludesVat: true } } },
      },
    },
  });
  if (!period) throw new Error('Billing period not found');

  const { client, cacheTarget, discoveredId } = await resolveMorningClient(period.institutionalOrder);

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
      ...(documentDate ? { date: documentDate } : {}),
    },
    cacheTarget,
    discoveredId,
  };
}

export async function previewBillingPeriod(billingPeriodId: string, documentDate?: string) {
  const { payload } = await buildMorningPayload(billingPeriodId, documentDate);
  return previewDocument(payload);
}

export async function issueBillingPeriod(billingPeriodId: string, issuedById?: string, documentDate?: string) {
  const period = await prisma.billingPeriod.findUnique({
    where: { id: billingPeriodId },
    include: { lines: true },
  });
  if (!period) throw new Error('Billing period not found');
  if (period.status === 'issued') throw new Error('Billing period already issued');
  if (period.status === 'cancelled') throw new Error('Billing period is cancelled');
  await assertPayingBodyComplete(billingPeriodId);

  const { payload, cacheTarget, discoveredId } = await buildMorningPayload(billingPeriodId, documentDate);
  const document = await createDocument(payload);
  // Morning returns the upserted client's id on the created document — cache it (or the
  // already-known search-match id) so future invoices bill this payer by id.
  const resolvedMorningClientId = discoveredId ?? document.client?.id ?? null;

  // Snapshot the client (לכבוד) name on the issued document for the monthly-accounts list.
  // Prefer the create response's client; otherwise read it back from the document.
  const morningClientName = document.client?.name?.trim() || (await fetchMorningDocClientName(document.id));

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
    // Cache the Morning client linkage (on the PayingBody, or the order for legacy payers)
    // so future invoices skip the lookup and never create a duplicate Morning customer.
    await cacheMorningClientId(tx, cacheTarget, resolvedMorningClientId);
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
        morningClientName,
        // Freeze exactly what went onto the proforma so every later 320/305/400 reuses it.
        proformaSnapshot: buildProformaSnapshot(payload, document.amount) as unknown as object,
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
  await assertPayingBodyComplete(billingPeriodId);

  const { payload, cacheTarget, discoveredId } = await buildMorningPayload(billingPeriodId);

  // Replace any prior draft so Morning's drafts area never accumulates stale copies.
  if (period.morningDraftId) {
    try { await deleteDraftDocument(period.morningDraftId); } catch { /* ignore — draft might already be gone */ }
  }

  const draft = await createDraftDocument(payload);

  return prisma.$transaction(async (tx) => {
    // A draft does not create a real Morning client, so only cache an id we already know
    // from a search match — never an upsert id (there is none until the draft is finalized).
    await cacheMorningClientId(tx, cacheTarget, discoveredId);
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
  proformaSource?: string | null;     // e.g. 'manual_morning' when linked from a doc issued directly in Morning
  morningClientName?: string | null;  // לכבוד name on the document; auto-read from morningDocId when omitted
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

  // Capture the Morning client name as it appears on the document so the monthly-accounts
  // list can show it. When the caller didn't pass it, read it from the linked document.
  const morningClientName =
    input.morningClientName ?? (input.morningDocId ? await fetchMorningDocClientName(input.morningDocId) : null);

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
        morningClientName,
        proformaSource: input.proformaSource ?? null,
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
  // Cheque details (relevant when type === PAYMENT_TYPES.CHEQUE).
  chequeNum?: string;
  bankName?: string;
  bankBranch?: string;
  bankAccount?: string;
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
    // Pass cheque details through only when present (and meaningful for cheque-type lines).
    ...(p.chequeNum ? { chequeNum: p.chequeNum } : {}),
    ...(p.bankName ? { bankName: p.bankName } : {}),
    ...(p.bankBranch ? { bankBranch: p.bankBranch } : {}),
    ...(p.bankAccount ? { bankAccount: p.bankAccount } : {}),
  }));
}

/** Build a 320 (tax invoice + receipt) payload from a period, attaching receipt lines. */
async function buildTaxReceiptPayload(
  billingPeriodId: string,
  payments?: TaxReceiptPaymentInput[],
  documentDate?: string,
) {
  const built = await buildMorningPayload(billingPeriodId);
  const snap = await ensureProformaSnapshot(billingPeriodId);
  if (snap) applyProformaSnapshot(built.payload, snap);
  built.payload.type = DOCUMENT_TYPES.TAX_INVOICE_RECEIPT; // 320
  const pays = payments ?? await defaultTaxReceiptPayments(billingPeriodId);
  built.payload.payment = toMorningPaymentArray(pays);
  // Optional: stamp the document with a specific date (e.g. the cheque's date) instead of today.
  // Morning enforces its own backdating window server-side and will reject dates outside it.
  if (documentDate) built.payload.date = documentDate;
  assertProformaAmountMatch(built.payload, snap, 'חשבונית מס/קבלה');
  return built;
}

/** Render a 320 preview PDF (base64) without creating anything in Morning. */
export async function previewTaxInvoice(
  billingPeriodId: string,
  payments?: TaxReceiptPaymentInput[],
  documentDate?: string,
) {
  const { payload } = await buildTaxReceiptPayload(billingPeriodId, payments, documentDate);
  return previewDocument(payload);
}

/**
 * Issue a binding tax invoice + receipt (חשבונית מס/קבלה, type 320) in Morning, out of the
 * period's proforma (חשבון עסקה, 300): the 320 is built from the frozen proforma snapshot and
 * linked to the proforma, and once issued the proforma is closed in Morning so it is no longer
 * counted as open. Receipt lines default to the payments recorded on the period, but can be
 * overridden — including cheque details (bank / branch / account / cheque number).
 */
export async function issueTaxInvoice(
  billingPeriodId: string,
  issuedById?: string,
  payments?: TaxReceiptPaymentInput[],
  documentDate?: string,
) {
  const period = await prisma.billingPeriod.findUnique({ where: { id: billingPeriodId } });
  if (!period) throw new Error('Billing period not found');
  if (period.status !== 'issued') throw new Error('Proforma must be issued first');
  if (period.taxInvoiceId) throw new Error('Tax invoice already issued for this period');
  await assertPayingBodyComplete(billingPeriodId);

  const { payload, cacheTarget, discoveredId } = await buildTaxReceiptPayload(billingPeriodId, payments, documentDate);
  // Link the 320 back to the proforma so Morning associates them (native "convert" relation).
  if (period.morningDocId) payload.linkedDocumentIds = [period.morningDocId];
  const document = await createDocument(payload);
  const resolvedMorningClientId = discoveredId ?? document.client?.id ?? null;

  const updated = await prisma.$transaction(async (tx) => {
    await cacheMorningClientId(tx, cacheTarget, resolvedMorningClientId);
    return tx.billingPeriod.update({
      where: { id: billingPeriodId },
      data: {
        taxInvoiceId: document.id,
        taxInvoiceNumber: document.number,
        taxInvoiceUrl: document.url?.he || document.url?.origin || null,
        taxInvoiceIssuedAt: new Date(),
        taxInvoiceIssuedById: issuedById,
        taxInvoiceType: DOCUMENT_TYPES.TAX_INVOICE_RECEIPT, // 320
      },
      include: { lines: true, institutionalOrder: true, payments: true },
    });
  });

  // Best-effort: close the proforma now that a binding 320 has been issued from it. The 320 is
  // already created and our DB is updated — never let a close failure (e.g. Morning already
  // closed it via the link, or transient error) undo or block the issued tax invoice.
  if (period.morningDocId) {
    try {
      await closeMorningDocument(period.morningDocId);
    } catch (err) {
      console.warn('[billing] issueTaxInvoice: failed to close proforma in Morning', period.morningDocId, err);
    }
  }

  return updated;
}

/**
 * Issue a standalone **tax invoice only** (חשבונית מס בלבד, Morning type 305) — no receipt,
 * no payment lines. Used to recognize revenue for tax purposes before the money arrives.
 * Receipts are issued later via {@link issueReceipt}, each linked back to this invoice.
 */
export async function issueTaxInvoiceOnly(
  billingPeriodId: string,
  issuedById?: string,
  documentDate?: string,
) {
  const period = await prisma.billingPeriod.findUnique({ where: { id: billingPeriodId } });
  if (!period) throw new Error('Billing period not found');
  if (period.status !== 'issued') throw new Error('Proforma must be issued first');
  if (period.taxInvoiceId) throw new Error('Tax invoice already issued for this period');
  await assertPayingBodyComplete(billingPeriodId);

  const { payload, cacheTarget, discoveredId } = await buildMorningPayload(billingPeriodId);
  const snap = await ensureProformaSnapshot(billingPeriodId);
  if (snap) applyProformaSnapshot(payload, snap);
  payload.type = DOCUMENT_TYPES.TAX_INVOICE; // 305 — binding tax invoice, no payment section
  if (documentDate) payload.date = documentDate;
  assertProformaAmountMatch(payload, snap, 'חשבונית מס');
  const document = await createDocument(payload);
  const resolvedMorningClientId = discoveredId ?? document.client?.id ?? null;

  return prisma.$transaction(async (tx) => {
    await cacheMorningClientId(tx, cacheTarget, resolvedMorningClientId);
    return tx.billingPeriod.update({
      where: { id: billingPeriodId },
      data: {
        taxInvoiceId: document.id,
        taxInvoiceNumber: document.number,
        taxInvoiceUrl: document.url?.he || document.url?.origin || null,
        taxInvoiceIssuedAt: new Date(),
        taxInvoiceIssuedById: issuedById,
        taxInvoiceType: DOCUMENT_TYPES.TAX_INVOICE, // 305
      },
      include: { lines: true, institutionalOrder: true, payments: true },
    });
  });
}

/**
 * Issue a standalone **receipt** (קבלה בלבד, Morning type 400) for a partial or full payment,
 * linked back to the period's 305 tax invoice via `linkedDocumentIds` (Morning closes the
 * invoice once it is fully receipted). The payment is recorded as a BillingPayment row, so the
 * period's paid/partial/paid-in-full roll-up — and the "stays open until fully paid" behaviour —
 * reuse the same logic as manual payments.
 */
export async function issueReceipt(
  billingPeriodId: string,
  input: { amount: number; method?: string | null; paidAt?: string | null; documentDate?: string },
  issuedById?: string,
) {
  const period = await prisma.billingPeriod.findUnique({ where: { id: billingPeriodId } });
  if (!period) throw new Error('Billing period not found');
  if (!period.taxInvoiceId) throw new Error('Issue the tax invoice (305) before issuing a receipt');
  if (period.taxInvoiceType !== DOCUMENT_TYPES.TAX_INVOICE) {
    throw new Error('Separate receipts apply only to a standalone 305 tax invoice (a 320 already includes a receipt)');
  }
  if (!(input.amount > 0)) throw new Error('Receipt amount must be positive');
  await assertPayingBodyComplete(billingPeriodId);

  const paidAtDate = input.paidAt ? new Date(input.paidAt) : new Date();
  const receiptDate = input.documentDate || paidAtDate.toISOString().slice(0, 10);

  const { payload, cacheTarget, discoveredId } = await buildMorningPayload(billingPeriodId);
  const snap = await ensureProformaSnapshot(billingPeriodId);
  if (snap) applyProformaSnapshot(payload, snap);
  payload.type = DOCUMENT_TYPES.RECEIPT; // 400
  payload.date = receiptDate;
  payload.linkedDocumentIds = [period.taxInvoiceId];
  payload.payment = toMorningPaymentArray([
    { date: receiptDate, type: methodToMorningType(input.method), amount: input.amount },
  ]);
  // The receipt's line items must mirror the proforma/tax invoice; only the payment amount
  // (input.amount) may be partial. Guard the item lines, not the payment.
  assertProformaAmountMatch(payload, snap, 'קבלה');
  const document = await createDocument(payload);
  const resolvedMorningClientId = discoveredId ?? document.client?.id ?? null;

  return prisma.$transaction(async (tx) => {
    await cacheMorningClientId(tx, cacheTarget, resolvedMorningClientId);
    await tx.billingPayment.create({
      data: {
        billingPeriodId,
        amount: input.amount,
        method: input.method || 'קבלה',
        paidAt: paidAtDate,
        recordedById: issuedById || null,
        morningReceiptId: document.id,
        morningReceiptNumber: document.number,
        morningReceiptUrl: document.url?.he || document.url?.origin || null,
      },
    });
    const sums = await tx.billingPayment.aggregate({ where: { billingPeriodId }, _sum: { amount: true } });
    const paidAmount = Number(sums._sum.amount ?? 0);
    const totalGross = Number(period.totalAmount) * 1.18;
    const isFullyPaid = paidAmount + 0.01 >= totalGross;
    const paymentStatus = isFullyPaid ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

    return tx.billingPeriod.update({
      where: { id: billingPeriodId },
      data: { paidAmount, paymentStatus, paidAt: isFullyPaid ? paidAtDate : null },
      include: { payments: { orderBy: { paidAt: 'desc' } }, lines: true, institutionalOrder: true },
    });
  });
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Link a חשבון עסקה (proforma, type 300) that was issued **directly in Morning** (outside the CRM)
 * as this period's proforma. Used when a document's date can't be back-set through our normal
 * issue path, so Ami issues it by hand in Morning and pastes the link/number here.
 *
 * We best-effort enrich from Morning: a UUID id → {@link getMorningDocument}; otherwise a document
 * number → {@link searchMorningDocuments} (restricted to proforma type). Whatever the user provided
 * is stored regardless of whether enrichment succeeds, and the period is marked issued with
 * proformaSource='manual_morning'.
 *
 * NOTE: Morning's public *share* URL carries an opaque token, not the API UUID — so a pasted share
 * link alone usually can't be resolved to the API document. Callers should also supply the document
 * number (preferred) or the API id when available. Live verification against Morning is required.
 */
export async function linkExternalProforma(
  billingPeriodId: string,
  input: { url?: string | null; documentNumber?: number | null; documentId?: string | null; issuedAt?: Date },
  issuedById?: string,
) {
  const period = await prisma.billingPeriod.findUnique({ where: { id: billingPeriodId } });
  if (!period) throw new Error('Billing period not found');
  if (period.status === 'issued') throw new Error('Billing period already issued');
  if (period.status === 'cancelled') throw new Error('Billing period is cancelled');

  // Resolve a UUID id from the explicit field or, failing that, from the pasted URL.
  const explicitId = input.documentId?.trim() || null;
  const urlId = input.url ? (input.url.match(UUID_RE)?.[0] ?? null) : null;
  let docId: string | null = explicitId || urlId;
  let docNumber: number | null = input.documentNumber ?? null;
  let docUrl: string | null = input.url?.trim() || null;
  let issuedAt = input.issuedAt;

  // Best-effort enrichment — never let a Morning lookup failure block the link.
  try {
    if (docId) {
      const doc = await getMorningDocument(docId);
      docNumber = docNumber ?? doc.number ?? null;
      docUrl = docUrl ?? doc.url?.he ?? doc.url?.origin ?? null;
      if (!issuedAt && doc.documentDate) issuedAt = new Date(doc.documentDate);
    } else if (docNumber != null) {
      const { items } = await searchMorningDocuments({ type: [DOCUMENT_TYPES.PROFORMA], number: docNumber });
      const match = items.find((d) => d.number === docNumber) ?? items[0];
      if (match) {
        docId = match.id ?? null;
        docUrl = docUrl ?? match.url?.he ?? match.url?.origin ?? null;
        if (!issuedAt && match.documentDate) issuedAt = new Date(match.documentDate);
      }
    }
  } catch (err) {
    // Enrichment is optional; proceed with whatever the caller provided.
    console.warn('[billing] linkExternalProforma: Morning enrichment failed', err);
  }

  if (docNumber == null) {
    throw new Error('A Morning document number (or a resolvable document id) is required to link an external proforma');
  }

  return markBillingPeriodIssuedManually(
    billingPeriodId,
    {
      morningDocNumber: docNumber,
      morningDocId: docId,
      morningDocUrl: docUrl,
      morningDocType: DOCUMENT_TYPES.PROFORMA, // 300
      issuedAt,
      proformaSource: 'manual_morning',
    },
    issuedById,
  );
}

/**
 * Link a קבלה (receipt, type 400) that was issued **directly in Morning** (outside the CRM)
 * to this period's standalone 305 tax invoice. Mirrors {@link issueReceipt}'s bookkeeping —
 * records a BillingPayment and rolls up paidAmount/paymentStatus — but does **not** create any
 * Morning document (the receipt already exists in Morning). Best-effort enriches the receipt
 * number/url from Morning by id or number so the payment row links back to the signed document.
 */
export async function linkExternalReceipt(
  billingPeriodId: string,
  input: {
    amount: number;
    method?: string | null;
    paidAt?: string | null;
    url?: string | null;
    documentNumber?: number | null;
    documentId?: string | null;
  },
  recordedById?: string,
) {
  const period = await prisma.billingPeriod.findUnique({ where: { id: billingPeriodId } });
  if (!period) throw new Error('Billing period not found');
  if (!period.taxInvoiceId) throw new Error('Issue the tax invoice (305) before linking a receipt');
  if (period.taxInvoiceType !== DOCUMENT_TYPES.TAX_INVOICE) {
    throw new Error('Linking a separate receipt applies only to a standalone 305 tax invoice (a 320 already includes a receipt)');
  }
  if (!(input.amount > 0)) throw new Error('Receipt amount must be positive');

  // Resolve a UUID id from the explicit field or, failing that, from the pasted URL.
  const explicitId = input.documentId?.trim() || null;
  const urlId = input.url ? (input.url.match(UUID_RE)?.[0] ?? null) : null;
  let docId: string | null = explicitId || urlId;
  let docNumber: number | null = input.documentNumber ?? null;
  let docUrl: string | null = input.url?.trim() || null;

  // Best-effort enrichment — never let a Morning lookup failure block the link.
  try {
    if (docId) {
      const doc = await getMorningDocument(docId);
      docNumber = docNumber ?? doc.number ?? null;
      docUrl = docUrl ?? doc.url?.he ?? doc.url?.origin ?? null;
    } else if (docNumber != null) {
      const { items } = await searchMorningDocuments({ type: [DOCUMENT_TYPES.RECEIPT], number: docNumber });
      const match = items.find((d) => d.number === docNumber) ?? items[0];
      if (match) {
        docId = match.id ?? null;
        docUrl = docUrl ?? match.url?.he ?? match.url?.origin ?? null;
      }
    }
  } catch (err) {
    console.warn('[billing] linkExternalReceipt: Morning enrichment failed', err);
  }

  if (docNumber == null) {
    throw new Error('A Morning receipt number (or a resolvable document id) is required to link an external receipt');
  }

  const paidAtDate = input.paidAt ? new Date(input.paidAt) : new Date();

  return prisma.$transaction(async (tx) => {
    await tx.billingPayment.create({
      data: {
        billingPeriodId,
        amount: input.amount,
        method: input.method || 'קבלה (מורנינג)',
        paidAt: paidAtDate,
        recordedById: recordedById || null,
        morningReceiptId: docId,
        morningReceiptNumber: docNumber,
        morningReceiptUrl: docUrl,
      },
    });
    const sums = await tx.billingPayment.aggregate({ where: { billingPeriodId }, _sum: { amount: true } });
    const paidAmount = Number(sums._sum.amount ?? 0);
    const totalGross = Number(period.totalAmount) * 1.18;
    const isFullyPaid = paidAmount + 0.01 >= totalGross;
    const paymentStatus = isFullyPaid ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

    return tx.billingPeriod.update({
      where: { id: billingPeriodId },
      data: { paidAmount, paymentStatus, paidAt: isFullyPaid ? paidAtDate : null },
      include: { payments: { orderBy: { paidAt: 'desc' } }, lines: true, institutionalOrder: true },
    });
  });
}

/**
 * Link a חשבונית מס (305) or חשבונית מס/קבלה (320) that was issued **directly in Morning**
 * (outside the CRM) to this period's tax invoice fields. Mirrors issueTaxInvoiceOnly /
 * issueTaxInvoice — but does NOT create any Morning document.
 *
 * For type 320: also marks the period as fully paid (period.totalAmount × 1.18 gross),
 * because a 320 includes a receipt — the money was received.
 * For type 305: only populates the tax invoice fields; receipts are linked separately.
 */
export async function linkExternalTaxInvoice(
  billingPeriodId: string,
  input: {
    documentType: 305 | 320;
    url?: string | null;
    documentNumber?: number | null;
    documentId?: string | null;
    issuedAt?: string | null;
  },
  issuedById?: string,
) {
  const period = await prisma.billingPeriod.findUnique({ where: { id: billingPeriodId } });
  if (!period) throw new Error('Billing period not found');
  if (period.status !== 'issued') throw new Error('Proforma must be issued first');
  if (period.taxInvoiceId) throw new Error('Tax invoice already linked for this period');

  const searchType = input.documentType === 305 ? DOCUMENT_TYPES.TAX_INVOICE : DOCUMENT_TYPES.TAX_INVOICE_RECEIPT;

  const explicitId = input.documentId?.trim() || null;
  const urlId = input.url ? (input.url.match(UUID_RE)?.[0] ?? null) : null;
  let docId: string | null = explicitId || urlId;
  let docNumber: number | null = input.documentNumber ?? null;
  let docUrl: string | null = input.url?.trim() || null;
  let issuedAt: Date | null = input.issuedAt ? new Date(input.issuedAt) : null;

  try {
    if (docId) {
      const doc = await getMorningDocument(docId);
      docNumber = docNumber ?? doc.number ?? null;
      docUrl = docUrl ?? doc.url?.he ?? doc.url?.origin ?? null;
      if (!issuedAt && doc.documentDate) issuedAt = new Date(doc.documentDate);
    } else if (docNumber != null) {
      const { items } = await searchMorningDocuments({ type: [searchType], number: docNumber });
      const match = items.find((d) => d.number === docNumber) ?? items[0];
      if (match) {
        docId = match.id ?? null;
        docUrl = docUrl ?? match.url?.he ?? match.url?.origin ?? null;
        if (!issuedAt && match.documentDate) issuedAt = new Date(match.documentDate);
      }
    }
  } catch (err) {
    console.warn('[billing] linkExternalTaxInvoice: Morning enrichment failed', err);
  }

  if (docNumber == null) {
    throw new Error('A Morning document number (or a resolvable document id) is required to link an external tax invoice');
  }

  const issuedAtDate = issuedAt ?? new Date();
  const is320 = input.documentType === DOCUMENT_TYPES.TAX_INVOICE_RECEIPT;
  const totalGross = Number(period.totalAmount) * 1.18;

  return prisma.billingPeriod.update({
    where: { id: billingPeriodId },
    data: {
      taxInvoiceId: docId,
      taxInvoiceNumber: docNumber,
      taxInvoiceUrl: docUrl,
      taxInvoiceIssuedAt: issuedAtDate,
      taxInvoiceIssuedById: issuedById || null,
      taxInvoiceType: input.documentType,
      ...(is320 && {
        paidAmount: totalGross,
        paymentStatus: 'paid',
        paidAt: issuedAtDate,
      }),
    },
    include: { lines: true, institutionalOrder: true, payments: true },
  });
}
