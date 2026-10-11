/**
 * v1.63.0 — cycle expenses via the v1 API + automatic net-revenue-percentage (commission)
 * recalculation. End-to-end through the real v1 router (API-key auth, scopes, audit) and the
 * internal /api/expenses route; Prisma is replaced by a small in-memory store so the
 * recalculation runs against real data transitions (cancel → revenue base shrinks, …).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// ── In-memory store ──────────────────────────────────────────────────────────

interface MeetingRow {
  id: string;
  cycleId: string;
  instructorId: string;
  status: string;
  revenue: number;
  instructorPayment: number;
  profit: number;
  deletedAt: Date | null;
  scheduledDate: Date;
  nature: string;
  registrationId: string | null;
}

const store = {
  cycles: new Map<string, { id: string; type: string; name: string }>(),
  meetings: new Map<string, MeetingRow>(),
  expenses: new Map<string, any>(),
  seq: 0,
};

const pick = (row: any) => (row ? { ...row } : null);

const matchesExpenseWhere = (e: any, where: any = {}) =>
  (where.cycleId === undefined || e.cycleId === where.cycleId) &&
  (where.isPercentage === undefined || e.isPercentage === where.isPercentage) &&
  (where.rateType === undefined || e.rateType === where.rateType);

vi.mock('../../../utils/prisma.js', () => {
  const fn = vi.fn;
  return {
    prisma: {
      apiKey: { findUnique: fn(), update: fn() },
      auditLog: { create: fn() },
      user: { update: fn(), findUnique: fn() },
      instructor: { findUnique: fn() },
      billingPeriodMeeting: { findFirst: fn() },
      meetingExpense: { aggregate: fn() },
      cycle: { findUnique: fn(), findFirst: fn(), update: fn() },
      meeting: { findUnique: fn(), findMany: fn(), update: fn(), aggregate: fn() },
      cycleExpense: { findMany: fn(), findUnique: fn(), create: fn(), update: fn(), delete: fn() },
      $transaction: fn(),
    },
  };
});

vi.mock('../../../services/instructor-payment.js', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recalculateDailyInstructorPaymentsForMeeting: vi.fn(async () => undefined),
}));
vi.mock('../../../services/negative-profit-alert.js', () => ({
  checkAndSendNegativeProfitAlert: vi.fn(async () => undefined),
}));
vi.mock('../../../services/replacement-meeting.js', () => ({
  addReplacementMeetingWithRetry: vi.fn(async () => 'replacement-1'),
}));

import { apiV1Router } from '../index.js';
import expensesRouter from '../../../routes/expenses.js';
import { config } from '../../../config.js';
import { prisma } from '../../../utils/prisma.js';
import { recalcPercentageExpensesSafe } from '../../../services/cycle-expenses.service.js';

const mockPrisma = vi.mocked(prisma, true);

const app = express();
app.use(express.json());
app.use('/api/v1', apiV1Router);
app.use('/api/expenses', expensesRouter);

// ── API keys ─────────────────────────────────────────────────────────────────

const keys = new Map<string, { id: string; name: string; scopes: string[]; raw: string }>();
function makeKey(id: string, name: string, scopes: string[]): string {
  const raw = `haitech_${crypto.randomBytes(32).toString('hex')}`;
  keys.set(crypto.createHash('sha256').update(raw).digest('hex'), { id, name, scopes, raw });
  return raw;
}
const jwtFor = (role: string) =>
  jwt.sign({ userId: `user-${role}`, email: `${role}@x.com`, name: role, role }, config.jwt.secret);

const flush = () => new Promise((r) => setTimeout(r, 20));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CYCLE = 'cycle-nitzanim-1';
const OTHER_CYCLE = 'cycle-other';

function seed() {
  store.cycles.clear();
  store.meetings.clear();
  store.expenses.clear();
  store.cycles.set(CYCLE, { id: CYCLE, type: 'institutional_fixed', name: 'ניצנים קבוצה 1' });
  store.cycles.set(OTHER_CYCLE, { id: OTHER_CYCLE, type: 'institutional_fixed', name: 'other' });
  // 4 meetings × 254.24 net = 1016.96 → 20% = 203.39
  for (let i = 1; i <= 4; i++) {
    store.meetings.set(`m${i}`, {
      id: `m${i}`,
      cycleId: CYCLE,
      instructorId: 'ins-1',
      status: 'scheduled',
      revenue: 254.24,
      instructorPayment: 100,
      profit: 154.24,
      deletedAt: null,
      scheduledDate: new Date(`2026-10-0${i}T00:00:00Z`),
      nature: 'regular',
      registrationId: null,
    });
  }
  // already cancelled meeting with stale revenue — must be excluded
  store.meetings.set('m-cancelled', {
    id: 'm-cancelled', cycleId: CYCLE, instructorId: 'ins-1', status: 'cancelled', revenue: 999, instructorPayment: 0,
    profit: 0, deletedAt: null, scheduledDate: new Date('2026-09-01T00:00:00Z'), nature: 'regular', registrationId: null,
  });
  // soft-deleted meeting — excluded
  store.meetings.set('m-deleted', {
    id: 'm-deleted', cycleId: CYCLE, instructorId: 'ins-1', status: 'completed', revenue: 500, instructorPayment: 0,
    profit: 0, deletedAt: new Date(), scheduledDate: new Date('2026-09-02T00:00:00Z'), nature: 'regular', registrationId: null,
  });
}

function addCommission(overrides: Record<string, unknown> = {}) {
  const row = {
    id: `exp-${++store.seq}`,
    cycleId: CYCLE,
    type: 'other',
    description: 'עמלת תיווך - אני זמיר (20% מהכנסה נטו ללא מע״מ)',
    amount: 1627.14, // stale frozen value
    isPercentage: true,
    percentage: 20,
    hours: null,
    rateType: 'net_revenue_percentage',
    status: 'approved',
    paymentDate: null,
    instructorId: null,
    createdById: 'user-ami',
    reviewedById: 'user-ami',
    reviewedAt: new Date(),
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  store.expenses.set(row.id, row);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();

  mockPrisma.apiKey.findUnique.mockImplementation((async ({ where }: any) => {
    const k = keys.get(where.keyHash);
    if (!k) return null;
    return {
      id: k.id, name: k.name, keyPrefix: k.raw.slice(0, 16), scopes: k.scopes, rateLimit: 100000, isActive: true,
      expiresAt: null, createdBy: { id: `creator-${k.id}`, email: 'ami@example.com', name: 'Ami', role: 'admin' },
    };
  }) as any);
  mockPrisma.apiKey.update.mockResolvedValue({} as never);
  mockPrisma.auditLog.create.mockResolvedValue({} as never);
  mockPrisma.user.update.mockResolvedValue({} as never);
  mockPrisma.billingPeriodMeeting.findFirst.mockResolvedValue(null as never);
  mockPrisma.meetingExpense.aggregate.mockResolvedValue({ _sum: { amount: 0 } } as never);
  mockPrisma.instructor.findUnique.mockResolvedValue({
    ratePreparation: 100, rateOnline: 120, rateFrontal: 150, employmentType: 'employee',
  } as never);

  mockPrisma.cycle.findUnique.mockImplementation((async ({ where }: any) => pick(store.cycles.get(where.id))) as any);
  mockPrisma.cycle.update.mockImplementation((async ({ where }: any) => pick(store.cycles.get(where.id))) as any);

  mockPrisma.meeting.findUnique.mockImplementation((async ({ where }: any) => {
    const m = store.meetings.get(where.id);
    if (!m) return null;
    return { ...m, cycle: { ...store.cycles.get(m.cycleId), registrations: [] } };
  }) as any);
  mockPrisma.meeting.update.mockImplementation((async ({ where, data }: any) => {
    const m = store.meetings.get(where.id)!;
    Object.assign(m, data);
    return { ...m };
  }) as any);
  mockPrisma.meeting.aggregate.mockImplementation((async ({ where }: any) => {
    const excluded: string[] = where.status?.notIn ?? [];
    let sum = 0;
    for (const m of store.meetings.values()) {
      if (m.cycleId !== where.cycleId) continue;
      if (where.deletedAt === null && m.deletedAt) continue;
      if (excluded.includes(m.status)) continue;
      sum += Number(m.revenue);
    }
    return { _sum: { revenue: sum } };
  }) as any);

  mockPrisma.cycleExpense.findMany.mockImplementation((async ({ where }: any) =>
    [...store.expenses.values()].filter((e) => matchesExpenseWhere(e, where)).map((e) => ({ ...e }))) as any);
  mockPrisma.cycleExpense.findUnique.mockImplementation((async ({ where }: any) => pick(store.expenses.get(where.id))) as any);
  mockPrisma.cycleExpense.create.mockImplementation((async ({ data }: any) => {
    const row = { id: `exp-${++store.seq}`, status: 'pending', reviewedById: null, reviewedAt: null, rejectionReason: null, createdAt: new Date(), updatedAt: new Date(), ...data };
    store.expenses.set(row.id, row);
    return { ...row };
  }) as any);
  mockPrisma.cycleExpense.update.mockImplementation((async ({ where, data }: any) => {
    const row = store.expenses.get(where.id);
    if (!row) throw new Error('not found');
    Object.assign(row, data);
    return { ...row };
  }) as any);
  mockPrisma.cycleExpense.delete.mockImplementation((async ({ where }: any) => {
    const row = store.expenses.get(where.id);
    store.expenses.delete(where.id);
    return row;
  }) as any);
});

const amountOf = (id: string) => Number(store.expenses.get(id)?.amount);

// ── Scopes ───────────────────────────────────────────────────────────────────

describe('cycle expenses — scopes', () => {
  it('read scope lists, but cannot write', async () => {
    addCommission();
    const key = makeKey('k-r', 'reader', ['read:cycle_expenses']);
    const list = await request(app).get(`/api/v1/cycles/${CYCLE}/expenses`).set('X-API-Key', key);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const post = await request(app).post(`/api/v1/cycles/${CYCLE}/expenses`).set('X-API-Key', key)
      .send({ type: 'equipment', amount: 50, paymentDate: '2026-10-01' });
    expect(post.status).toBe(403);
    expect(post.body.error.message).toContain('write:cycle_expenses');
    const recalc = await request(app).post(`/api/v1/cycles/${CYCLE}/expenses/recalculate`).set('X-API-Key', key);
    expect(recalc.status).toBe(403);
    expect(mockPrisma.cycleExpense.create).not.toHaveBeenCalled();
  });

  it('a key without cycle-expense scopes is rejected; read:* / write:* grant them', async () => {
    const none = makeKey('k-none', 'none', ['read:cycles', 'write:cycles']);
    expect((await request(app).get(`/api/v1/cycles/${CYCLE}/expenses`).set('X-API-Key', none)).status).toBe(403);

    const broad = makeKey('k-broad', 'broad', ['read:*', 'write:*']);
    expect((await request(app).get(`/api/v1/cycles/${CYCLE}/expenses`).set('X-API-Key', broad)).status).toBe(200);
    const created = await request(app).post(`/api/v1/cycles/${CYCLE}/expenses`).set('X-API-Key', broad)
      .send({ type: 'equipment', amount: 50, paymentDate: '2026-10-01' });
    expect(created.status).toBe(201);
  });

  it('JWT: operations_manager may read but not write; instructors get nothing', async () => {
    expect((await request(app).get(`/api/v1/cycles/${CYCLE}/expenses`).set('Authorization', `Bearer ${jwtFor('operations_manager')}`)).status).toBe(200);
    expect((await request(app).post(`/api/v1/cycles/${CYCLE}/expenses`).set('Authorization', `Bearer ${jwtFor('operations_manager')}`)
      .send({ type: 'equipment', amount: 50, paymentDate: '2026-10-01' })).status).toBe(403);
    expect((await request(app).get(`/api/v1/cycles/${CYCLE}/expenses`).set('Authorization', `Bearer ${jwtFor('instructor')}`)).status).toBe(403);
  });

  it('404 for an unknown cycle', async () => {
    const key = makeKey('k-404', 'x', ['read:cycle_expenses']);
    expect((await request(app).get('/api/v1/cycles/nope/expenses').set('X-API-Key', key)).status).toBe(404);
  });
});

// ── Create / update / review / delete ───────────────────────────────────────

describe('cycle expenses — CRUD via v1', () => {
  const writer = () => makeKey('k-w', 'Claw', ['read:cycle_expenses', 'write:cycle_expenses']);

  it('creates a commission with an auto-computed amount (client amount ignored), attributed to the key', async () => {
    const res = await request(app).post(`/api/v1/cycles/${CYCLE}/expenses`).set('X-API-Key', writer()).send({
      type: 'other',
      description: 'עמלת תיווך 20%',
      isPercentage: true,
      percentage: 20,
      rateType: 'net_revenue_percentage',
      amount: 99999,
      paymentDate: '2026-10-31',
      status: 'approved',
    });
    expect(res.status).toBe(201);
    // 4 × 254.24 = 1016.96 → 20% = 203.392 → 203.39 (cancelled + deleted meetings excluded)
    expect(Number(res.body.data.amount)).toBe(203.39);
    expect(res.body.data.status).toBe('approved');

    const createData = mockPrisma.cycleExpense.create.mock.calls[0][0].data;
    expect(createData.createdById).toBeNull();
    const reviewData = mockPrisma.cycleExpense.update.mock.calls[0][0].data;
    expect(reviewData).toMatchObject({ status: 'approved', reviewedById: null });

    await flush();
    const audits = mockPrisma.auditLog.create.mock.calls.map((c: any) => c[0].data).filter((d: any) => d.entity === 'CycleExpense');
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits[0]).toMatchObject({ action: 'CREATE', apiKeyId: 'k-w', userId: null, userName: 'api-key:Claw' });
  });

  it('applies the same validation as the CRM UI', async () => {
    const key = writer();
    const noDate = await request(app).post(`/api/v1/cycles/${CYCLE}/expenses`).set('X-API-Key', key).send({ type: 'equipment', amount: 50 });
    expect(noDate.status).toBe(400);
    const noAmount = await request(app).post(`/api/v1/cycles/${CYCLE}/expenses`).set('X-API-Key', key).send({ type: 'equipment', paymentDate: '2026-10-01' });
    expect(noAmount.status).toBe(400);
    const noPct = await request(app).post(`/api/v1/cycles/${CYCLE}/expenses`).set('X-API-Key', key)
      .send({ type: 'other', isPercentage: true, rateType: 'net_revenue_percentage', paymentDate: '2026-10-01' });
    expect(noPct.status).toBe(400);
    const badType = await request(app).post(`/api/v1/cycles/${CYCLE}/expenses`).set('X-API-Key', key).send({ type: 'pizza', amount: 5, paymentDate: '2026-10-01' });
    expect(badType.status).toBe(400);
    expect(mockPrisma.cycleExpense.create).not.toHaveBeenCalled();
  });

  it('hours-based expense keeps the UI formula (hours × rate × 1.3 for employees)', async () => {
    const res = await request(app).post(`/api/v1/cycles/${CYCLE}/expenses`).set('X-API-Key', writer())
      .send({ type: 'wraparound_hours', hours: 2, rateType: 'frontal', instructorId: 'ins-1', paymentDate: '2026-10-01', amount: 1 });
    expect(res.status).toBe(201);
    expect(Number(res.body.data.amount)).toBeCloseTo(2 * 150 * 1.3);
    expect(res.body.data.status).toBe('pending');
  });

  it('PUT edits partially (recomputes commission, back to pending) and approves via status', async () => {
    const exp = addCommission();
    const key = writer();
    // Prod commission rows have no paymentDate — like the UI edit form, an edit requires one.
    const noDate = await request(app).put(`/api/v1/cycles/${CYCLE}/expenses/${exp.id}`).set('X-API-Key', key).send({ percentage: 10 });
    expect(noDate.status).toBe(400);
    const edit = await request(app).put(`/api/v1/cycles/${CYCLE}/expenses/${exp.id}`).set('X-API-Key', key)
      .send({ percentage: 10, paymentDate: '2026-10-31' });
    expect(edit.status).toBe(200);
    expect(amountOf(exp.id)).toBe(101.7); // 10% × 1016.96 = 101.696
    expect(store.expenses.get(exp.id).status).toBe('pending');
    expect(store.expenses.get(exp.id).rateType).toBe('net_revenue_percentage');

    const approve = await request(app).put(`/api/v1/cycles/${CYCLE}/expenses/${exp.id}`).set('X-API-Key', key).send({ status: 'approved' });
    expect(approve.status).toBe(200);
    expect(store.expenses.get(exp.id)).toMatchObject({ status: 'approved', reviewedById: null });
  });

  it('PUT/DELETE refuse an expense of a different cycle', async () => {
    const exp = addCommission({ cycleId: OTHER_CYCLE });
    const key = writer();
    expect((await request(app).put(`/api/v1/cycles/${CYCLE}/expenses/${exp.id}`).set('X-API-Key', key).send({ status: 'approved' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/cycles/${CYCLE}/expenses/${exp.id}`).set('X-API-Key', key)).status).toBe(404);
    expect(store.expenses.has(exp.id)).toBe(true);
  });

  it('DELETE removes the expense', async () => {
    const exp = addCommission();
    const res = await request(app).delete(`/api/v1/cycles/${CYCLE}/expenses/${exp.id}`).set('X-API-Key', writer());
    expect(res.status).toBe(200);
    expect(store.expenses.has(exp.id)).toBe(false);
  });
});

// ── Recalculation ───────────────────────────────────────────────────────────

describe('percentage (commission) recalculation', () => {
  it('recalculate endpoint fixes a stale amount; dryRun does not write; approval kept', async () => {
    const exp = addCommission();
    const fixed = addCommission({ isPercentage: false, percentage: null, rateType: null, amount: 300, type: 'travel_fixed' });
    const legacyPct = addCommission({ rateType: null, amount: null, percentage: 15 });
    const key = makeKey('k-rc', 'Claw', ['write:cycle_expenses']);

    const dry = await request(app).post(`/api/v1/cycles/${CYCLE}/expenses/recalculate?dryRun=true`).set('X-API-Key', key);
    expect(dry.status).toBe(200);
    expect(dry.body.data).toMatchObject({ netRevenue: 1016.96, dryRun: true, updated: 0 });
    expect(dry.body.data.expenses[0]).toMatchObject({ id: exp.id, oldAmount: 1627.14, newAmount: 203.39, changed: true });
    expect(amountOf(exp.id)).toBe(1627.14);

    const res = await request(app).post(`/api/v1/cycles/${CYCLE}/expenses/recalculate`).set('X-API-Key', key);
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);
    expect(amountOf(exp.id)).toBe(203.39);
    expect(store.expenses.get(exp.id).status).toBe('approved');
    // untouched: fixed and legacy percentage rows
    expect(amountOf(fixed.id)).toBe(300);
    expect(store.expenses.get(legacyPct.id).amount).toBeNull();
  });

  it('meeting cancelled via bulk-update-status → commission drops', async () => {
    const exp = addCommission({ amount: 203.39 });
    const key = makeKey('k-m', 'Claw', ['write:meetings']);
    const res = await request(app).post('/api/v1/meetings/bulk-update-status').set('X-API-Key', key)
      .send({ ids: ['m1', 'm2'], status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.data.errors).toBeUndefined();
    // 2 × 254.24 = 508.48 → 20% = 101.70
    expect(amountOf(exp.id)).toBe(101.7);
    await flush();
    const audit = mockPrisma.auditLog.create.mock.calls.map((c: any) => c[0].data)
      .find((d: any) => d.entity === 'CycleExpense' && d.entityId === exp.id);
    expect(audit).toMatchObject({ apiKeyId: 'k-m', newValue: expect.objectContaining({ amount: 101.7, trigger: 'meeting-bulk-status' }) });
  });

  it('revenue bulk-update → commission follows', async () => {
    const exp = addCommission({ amount: 203.39 });
    const key = makeKey('k-m2', 'Claw', ['write:meetings']);
    const res = await request(app).post('/api/v1/meetings/bulk-update').set('X-API-Key', key)
      .send({ ids: ['m1', 'm2', 'm3', 'm4'], data: { revenue: 300 } });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(4);
    expect(amountOf(exp.id)).toBe(240); // 20% × 1200
  });

  it('only the touched cycle is recalculated, and failures never throw', async () => {
    const other = addCommission({ cycleId: OTHER_CYCLE, amount: 55 });
    mockPrisma.meeting.aggregate.mockRejectedValueOnce(new Error('db down'));
    const exp = addCommission({ amount: 1 });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recalcPercentageExpensesSafe([CYCLE, CYCLE], 'test')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(amountOf(exp.id)).toBe(1); // failed run left it alone
    await recalcPercentageExpensesSafe(CYCLE, 'test');
    expect(amountOf(exp.id)).toBe(203.39);
    expect(amountOf(other.id)).toBe(55);
  });

  it('is a single cheap query for cycles without percentage expenses', async () => {
    await recalcPercentageExpensesSafe(CYCLE, 'test');
    expect(mockPrisma.cycleExpense.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.meeting.aggregate).not.toHaveBeenCalled();
  });
});

// ── Internal CRM route still works ──────────────────────────────────────────

describe('internal /api/expenses/cycle (CRM UI)', () => {
  const auth = () => ({ Authorization: `Bearer ${jwtFor('admin')}` });

  it('creates fixed and commission expenses with the user as creator', async () => {
    const fixed = await request(app).post('/api/expenses/cycle').set(auth())
      .send({ cycleId: CYCLE, type: 'equipment', amount: 120, paymentDate: '2026-10-05' });
    expect(fixed.status).toBe(201);
    expect(Number(fixed.body.amount)).toBe(120);
    expect(fixed.body.status).toBe('pending');
    expect(mockPrisma.cycleExpense.create.mock.calls[0][0].data.createdById).toBe('user-admin');

    const pct = await request(app).post('/api/expenses/cycle').set(auth())
      .send({ cycleId: CYCLE, type: 'other', isPercentage: true, percentage: 20, rateType: 'net_revenue_percentage', paymentDate: '2026-10-05' });
    expect(pct.status).toBe(201);
    expect(Number(pct.body.amount)).toBe(203.39);

    // legacy UI percentage (no rateType) keeps amount NULL, as before
    const legacy = await request(app).post('/api/expenses/cycle').set(auth())
      .send({ cycleId: CYCLE, type: 'other', isPercentage: true, percentage: 15, paymentDate: '2026-10-05' });
    expect(legacy.status).toBe(201);
    expect(legacy.body.amount).toBeNull();
  });

  it('keeps its error format and validation', async () => {
    const res = await request(app).post('/api/expenses/cycle').set(auth()).send({ cycleId: CYCLE, type: 'equipment', amount: 120 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'תאריך תשלום הוא שדה חובה' });
  });

  it('UI edit of a commission row (no rateType sent) keeps it automatic', async () => {
    const exp = addCommission();
    const res = await request(app).put(`/api/expenses/cycle/${exp.id}`).set(auth())
      .send({ type: 'other', description: 'x', isPercentage: true, percentage: 20, paymentDate: '2026-10-05' });
    expect(res.status).toBe(200);
    expect(store.expenses.get(exp.id)).toMatchObject({ rateType: 'net_revenue_percentage', status: 'pending' });
    expect(amountOf(exp.id)).toBe(203.39);
  });

  it('review and delete', async () => {
    const exp = addCommission({ status: 'pending' });
    const review = await request(app).patch(`/api/expenses/cycle/${exp.id}/review`).set(auth()).send({ status: 'approved' });
    expect(review.status).toBe(200);
    expect(store.expenses.get(exp.id)).toMatchObject({ status: 'approved', reviewedById: 'user-admin' });
    const del = await request(app).delete(`/api/expenses/cycle/${exp.id}`).set(auth());
    expect(del.status).toBe(204);
    expect(store.expenses.has(exp.id)).toBe(false);
  });
});
