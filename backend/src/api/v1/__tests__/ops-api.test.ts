/**
 * v1 ops/admin API (v1.62.0) — end-to-end through the real v1 router: real API-key auth
 * (hash lookup), scope enforcement, rate limiting and audit; only Prisma is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../../utils/prisma.js', () => {
  const model = () => ({
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    aggregate: vi.fn(),
  });
  return {
    prisma: {
      apiKey: model(),
      auditLog: model(),
      institutionalOrder: model(),
      payingBody: model(),
      instructor: model(),
      instructorFixedAddition: model(),
      meeting: model(),
      cycle: model(),
      meetingExpense: model(),
      billingPeriodMeeting: model(),
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    },
  };
});

vi.mock('../../../services/instructorReport.service.js', () => ({
  buildInstructorMonthlyReport: vi.fn(async (month: string) => ({ month, instructors: [], summaryGrandTotal: 0 })),
  getPreviousMonth: vi.fn(() => '2026-09'),
}));

import { apiV1Router } from '../index.js';
import { config } from '../../../config.js';
import { prisma } from '../../../utils/prisma.js';
import { buildInstructorMonthlyReport } from '../../../services/instructorReport.service.js';
import {
  __resetBotConfigStateForTests,
  getKnowledgeBase,
  getBotConfigStatus,
  getSystemPrompt,
  initBotConfigFromDB,
  loadBotConfigFromFiles,
} from '../../../services/wa-bot-config.js';

const mockPrisma = vi.mocked(prisma, true);

const app = express();
app.use(express.json());
app.use('/api/v1', apiV1Router);

// ── API key fixtures ─────────────────────────────────────────────────────────

interface KeyFixture {
  id: string;
  name: string;
  scopes: string[];
  rateLimit?: number;
  creatorRole?: string;
}

const keys = new Map<string, KeyFixture & { raw: string }>();
let keyCounter = 0;

/** Register a key and return its raw value (haitech_<hex>). */
function makeKey(fixture: KeyFixture): string {
  keyCounter += 1;
  const raw = `haitech_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  keys.set(hash, { ...fixture, raw });
  return raw;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.apiKey.findUnique.mockImplementation((async ({ where }: any) => {
    const k = keys.get(where.keyHash);
    if (!k) return null;
    return {
      id: k.id,
      name: k.name,
      keyPrefix: k.raw.slice(0, 16),
      scopes: k.scopes,
      rateLimit: k.rateLimit ?? 100000,
      isActive: true,
      expiresAt: null,
      createdBy: { id: `creator-of-${k.id}`, email: 'ami@example.com', name: 'Ami', role: k.creatorRole ?? 'admin' },
    };
  }) as any);
  mockPrisma.apiKey.update.mockResolvedValue({} as never);
  mockPrisma.auditLog.create.mockResolvedValue({} as never);
});

/** Let res.on('finish') handlers (audit middleware) run. */
const flush = () => new Promise((r) => setTimeout(r, 20));

const branchId = '046d5fac-1282-492f-ae12-e876566967c4';
const payingBodyId = 'a1b2c3d4-0000-4000-8000-000000000000';

// ── Scope enforcement ────────────────────────────────────────────────────────

describe('scope enforcement', () => {
  it('returns 403 when the key lacks the required scope', async () => {
    const key = makeKey({ id: 'k-read', name: 'reader', scopes: ['read:institutional_orders'] });
    const res = await request(app)
      .post('/api/v1/institutional-orders')
      .set('X-API-Key', key)
      .send({ branchId, payingBodyId, orderName: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('write:institutional_orders');
    expect(mockPrisma.institutionalOrder.create).not.toHaveBeenCalled();
  });

  it('ignores the key creator\'s role — only scopes count', async () => {
    // Creator is an admin, but the key has no paying_bodies scope.
    const key = makeKey({ id: 'k-admin-creator', name: 'x', scopes: ['read:cycles'], creatorRole: 'admin' });
    const res = await request(app).get('/api/v1/paying-bodies').set('X-API-Key', key);
    expect(res.status).toBe(403);

    // Creator is an instructor, but the key has the scope → allowed.
    mockPrisma.payingBody.findMany.mockResolvedValue([] as never);
    mockPrisma.payingBody.count.mockResolvedValue(0 as never);
    const key2 = makeKey({ id: 'k-instr-creator', name: 'y', scopes: ['read:paying_bodies'], creatorRole: 'instructor' });
    const res2 = await request(app).get('/api/v1/paying-bodies').set('X-API-Key', key2);
    expect(res2.status).toBe(200);
    expect(res2.body.pagination).toMatchObject({ page: 1, total: 0 });
  });

  it('broad scopes (*, read:*, write:*) do NOT grant bot config or salary reports', async () => {
    const key = makeKey({ id: 'k-star', name: 'star', scopes: ['*', 'read:*', 'write:*'] });
    expect((await request(app).get('/api/v1/bot-config').set('X-API-Key', key)).status).toBe(403);
    expect((await request(app).get('/api/v1/bot-config/status').set('X-API-Key', key)).status).toBe(403);
    expect((await request(app).put('/api/v1/bot-config').set('X-API-Key', key).send({ systemPrompt: 'x' })).status).toBe(403);
    expect((await request(app).get('/api/v1/reports/instructor-salaries').set('X-API-Key', key)).status).toBe(403);
    expect(buildInstructorMonthlyReport).not.toHaveBeenCalled();
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('broad scopes still grant the non-sensitive ops scopes', async () => {
    mockPrisma.institutionalOrder.findMany.mockResolvedValue([] as never);
    mockPrisma.institutionalOrder.count.mockResolvedValue(0 as never);
    const key = makeKey({ id: 'k-readall', name: 'readall', scopes: ['read:*'] });
    const res = await request(app).get('/api/v1/institutional-orders').set('X-API-Key', key);
    expect(res.status).toBe(200);
  });

  it('explicitly listed salary scope grants the report', async () => {
    const key = makeKey({ id: 'k-salary', name: 'salary', scopes: ['read:salary_reports'] });
    const res = await request(app).get('/api/v1/reports/instructor-salaries?month=2026-08').set('X-API-Key', key);
    expect(res.status).toBe(200);
    expect(buildInstructorMonthlyReport).toHaveBeenCalledWith('2026-08');
    expect(res.body.data.month).toBe('2026-08');
  });

  it('rejects a malformed month for the salary report', async () => {
    const key = makeKey({ id: 'k-salary2', name: 'salary', scopes: ['read:salary_reports'] });
    const res = await request(app).get('/api/v1/reports/instructor-salaries?month=2026-13').set('X-API-Key', key);
    expect(res.status).toBe(400);
  });

  it('JWT users get the same roles as the CRM UI route (no API key involved)', async () => {
    mockPrisma.payingBody.findMany.mockResolvedValue([] as never);
    mockPrisma.payingBody.count.mockResolvedValue(0 as never);
    const token = (role: string) => jwt.sign({ userId: `u-${role}`, email: `${role}@x.com`, name: role, role }, config.jwt.secret);
    expect((await request(app).get('/api/v1/paying-bodies').set('Authorization', `Bearer ${token('manager')}`)).status).toBe(200);
    expect((await request(app).get('/api/v1/paying-bodies').set('Authorization', `Bearer ${token('operations')}`)).status).toBe(403);
    expect((await request(app).get('/api/v1/bot-config/status').set('Authorization', `Bearer ${token('admin')}`)).status).toBe(200);
  });

  it('401 for an unknown key', async () => {
    const res = await request(app).get('/api/v1/paying-bodies').set('X-API-Key', 'haitech_deadbeef');
    expect(res.status).toBe(401);
  });
});

// ── Institutional orders ─────────────────────────────────────────────────────

describe('institutional orders', () => {
  const writer = () => makeKey({ id: 'k-orders', name: 'Claw', scopes: ['write:institutional_orders'] });

  it('create requires a paying body (and branch)', async () => {
    const key = writer();
    const noPb = await request(app).post('/api/v1/institutional-orders').set('X-API-Key', key).send({ branchId, orderName: 'x' });
    expect(noPb.status).toBe(400);
    const noBranch = await request(app).post('/api/v1/institutional-orders').set('X-API-Key', key).send({ payingBodyId, orderName: 'x' });
    expect(noBranch.status).toBe(400);
    expect(mockPrisma.institutionalOrder.create).not.toHaveBeenCalled();
  });

  it('creates with branch + paying body and audits to the API key (not a human)', async () => {
    mockPrisma.institutionalOrder.create.mockResolvedValue({ id: 'order-1', branchId, payingBodyId, orderName: 'בית ספר', status: 'draft' } as never);
    const key = writer();
    const res = await request(app)
      .post('/api/v1/institutional-orders')
      .set('X-API-Key', key)
      .send({ branchId, payingBodyId, orderName: 'בית ספר', pricePerMeeting: '350' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('order-1');
    expect(mockPrisma.institutionalOrder.create.mock.calls[0][0].data).toMatchObject({ branchId, payingBodyId, pricePerMeeting: 350 });

    await flush();
    // Exactly one audit row: the explicit one (the generic middleware must not duplicate it).
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'CREATE',
      entity: 'InstitutionalOrder',
      entityId: 'order-1',
      apiKeyId: 'k-orders',
      userId: null,
      userName: 'api-key:Claw',
    });
  });

  it('update audits the diff attributed to the API key', async () => {
    mockPrisma.institutionalOrder.findUnique.mockResolvedValue({ id: 'order-1', status: 'draft', orderName: 'a' } as never);
    mockPrisma.institutionalOrder.update.mockResolvedValue({ id: 'order-1', status: 'active', orderName: 'a' } as never);
    const key = writer();
    const res = await request(app).put('/api/v1/institutional-orders/order-1').set('X-API-Key', key).send({ status: 'active' });
    expect(res.status).toBe(200);
    await flush();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'UPDATE',
      entity: 'InstitutionalOrder',
      apiKeyId: 'k-orders',
      userId: null,
      oldValue: { status: 'draft' },
      newValue: { status: 'active' },
    });
  });
});

// ── Paying bodies ────────────────────────────────────────────────────────────

describe('paying bodies', () => {
  it('create enforces name/taxId/contactName/email and audits to the key', async () => {
    const key = makeKey({ id: 'k-pb', name: 'Claw', scopes: ['write:paying_bodies'] });
    const bad = await request(app).post('/api/v1/paying-bodies').set('X-API-Key', key).send({ name: 'עיריית עומר' });
    expect(bad.status).toBe(400);
    expect(mockPrisma.payingBody.create).not.toHaveBeenCalled();

    mockPrisma.payingBody.create.mockResolvedValue({ id: 'pb-1', name: 'עיריית עומר', taxId: '500000000' } as never);
    const ok = await request(app)
      .post('/api/v1/paying-bodies')
      .set('X-API-Key', key)
      .send({ name: 'עיריית עומר', taxId: '500000000', contactName: 'דנה', email: 'dana@omer.muni.il' });
    expect(ok.status).toBe(201);
    expect(mockPrisma.payingBody.create.mock.calls[0][0].data.isComplete).toBe(true);
    await flush();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entity: 'PayingBody', apiKeyId: 'k-pb', userId: null, userName: 'api-key:Claw',
    });
  });

  it('update can complete a partial row', async () => {
    const key = makeKey({ id: 'k-pb2', name: 'Claw', scopes: ['write:paying_bodies'] });
    mockPrisma.payingBody.findUnique.mockResolvedValue({ id: 'pb-2', name: 'x', taxId: null, contactName: null, email: null } as never);
    mockPrisma.payingBody.update.mockResolvedValue({ id: 'pb-2' } as never);
    const res = await request(app)
      .put('/api/v1/paying-bodies/pb-2')
      .set('X-API-Key', key)
      .send({ taxId: '123', contactName: 'c', email: 'c@x.com' });
    expect(res.status).toBe(200);
    expect(mockPrisma.payingBody.update.mock.calls[0][0].data.isComplete).toBe(true);
  });
});

// ── Bot config ───────────────────────────────────────────────────────────────

describe('bot config', () => {
  const botKey = () => makeKey({ id: 'k-bot', name: 'Claw', scopes: ['read:bot_config', 'write:bot_config'] });

  beforeEach(() => {
    __resetBotConfigStateForTests();
    loadBotConfigFromFiles();
  });

  it('rejects an invalid JSON knowledge base and writes nothing', async () => {
    const before = getKnowledgeBase();
    const res = await request(app)
      .put('/api/v1/bot-config')
      .set('X-API-Key', botKey())
      .send({ systemPrompt: 'new prompt', knowledgeBase: '{"courses": {}} trailing text' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/valid JSON/);
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    // Validation happens before any write: the prompt must not be half-applied either.
    expect(getSystemPrompt()).not.toBe('new prompt');
    expect(getKnowledgeBase()).toBe(before);
  });

  it('rejects a knowledge base that is valid JSON but not an object', async () => {
    const res = await request(app).put('/api/v1/bot-config').set('X-API-Key', botKey()).send({ knowledgeBase: '[1,2]' });
    expect(res.status).toBe(400);
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('applies a valid update live (same in-memory state the bot uses) and audits to the key', async () => {
    mockPrisma.$executeRaw.mockResolvedValue(1 as never);
    const key = botKey();
    const res = await request(app)
      .put('/api/v1/bot-config')
      .set('X-API-Key', key)
      .send({ systemPrompt: 'You are Rodi', knowledgeBase: { courses: { digital_self_paced: [{ title: 'Python' }] } } });
    expect(res.status).toBe(200);
    expect(res.body.data.changed).toEqual(['system_prompt', 'knowledge_base']);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);

    // Live: the getters the WhatsApp bot calls now return the new values.
    expect(getSystemPrompt()).toBe('You are Rodi');
    expect(getKnowledgeBase()).toEqual({ courses: { digital_self_paced: [{ title: 'Python' }] } });

    const status = await request(app).get('/api/v1/bot-config/status').set('X-API-Key', key);
    expect(status.body.data.knowledgeBase).toMatchObject({ parsed: true, rawSource: 'db', effectiveSource: 'db', inSync: true });
    expect(status.body.data.lastUpdatedBy).toBe('api-key:Claw');

    await flush();
    const auditRows = mockPrisma.auditLog.create.mock.calls.map((c: any) => c[0].data);
    expect(auditRows).toHaveLength(2);
    for (const row of auditRows) {
      expect(row).toMatchObject({ entity: 'BotConfig', apiKeyId: 'k-bot', userId: null, userName: 'api-key:Claw' });
    }
  });

  it('status reports a DB knowledge base that does not parse (bot still on the file KB)', async () => {
    const fileKb = getKnowledgeBase();
    mockPrisma.$queryRaw.mockResolvedValue([
      { key: 'knowledge_base', value: '{"courses": {}}\n\nNEW COURSE: robotics...' },
    ] as never);
    await initBotConfigFromDB();

    expect(getKnowledgeBase()).toBe(fileKb);
    const status = getBotConfigStatus();
    expect(status.knowledgeBase).toMatchObject({ parsed: false, rawSource: 'db', effectiveSource: 'file', inSync: false });
    expect(status.knowledgeBase.parseError).toBeTruthy();

    const res = await request(app).get('/api/v1/bot-config').set('X-API-Key', botKey());
    expect(res.status).toBe(200);
    expect(res.body.data.status.knowledgeBase.parsed).toBe(false);
    // The raw (broken) DB text is returned so it can be fixed.
    expect(res.body.data.knowledgeBase).toContain('NEW COURSE');
  });
});

// ── Fixed additions ─────────────────────────────────────────────────────────

describe('instructor fixed additions', () => {
  it('create stores createdById = null for API keys and audits to the key', async () => {
    const key = makeKey({ id: 'k-add', name: 'Claw', scopes: ['write:instructor_additions'] });
    mockPrisma.instructor.findUnique.mockResolvedValue({ id: 'kim' } as never);
    mockPrisma.instructorFixedAddition.create.mockResolvedValue({
      id: 'add-1', instructorId: 'kim', description: 'ריכוז', amount: { toString: () => '2500.00' }, isNet: true,
      startMonth: new Date('2026-10-01T00:00:00Z'), endMonth: null, notes: null, createdById: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const res = await request(app)
      .post('/api/v1/instructors/kim/fixed-additions')
      .set('X-API-Key', key)
      .send({ description: 'ריכוז', amount: 2500, startMonth: '2026-10' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 'add-1', amount: 2500, startMonth: '2026-10' });
    expect(mockPrisma.instructorFixedAddition.create.mock.calls[0][0].data.createdById).toBeNull();
    await flush();
    expect(mockPrisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ apiKeyId: 'k-add', userId: null });
  });

  it('read scope cannot write', async () => {
    const key = makeKey({ id: 'k-add-r', name: 'r', scopes: ['read:instructor_additions'] });
    const res = await request(app).delete('/api/v1/instructors/kim/fixed-additions/add-1').set('X-API-Key', key);
    expect(res.status).toBe(403);
  });
});

// ── Meetings bulk ────────────────────────────────────────────────────────────

describe('meetings bulk-update', () => {
  it('requires exactly one selector', async () => {
    const key = makeKey({ id: 'k-m', name: 'Claw', scopes: ['write:meetings'] });
    const res = await request(app).post('/api/v1/meetings/bulk-update').set('X-API-Key', key).send({ data: { topic: 'x' } });
    expect(res.status).toBe(400);
  });

  it('refuses to combine a manual revenue with a status change', async () => {
    const key = makeKey({ id: 'k-m2', name: 'Claw', scopes: ['write:meetings'] });
    const res = await request(app)
      .post('/api/v1/meetings/bulk-update')
      .set('X-API-Key', key)
      .send({ ids: ['m1'], data: { status: 'completed', revenue: 100 } });
    expect(res.status).toBe(400);
    expect(mockPrisma.meeting.update).not.toHaveBeenCalled();
  });

  it('sets revenue by cycle selector, derives profit, audits each meeting to the key', async () => {
    const key = makeKey({ id: 'k-m3', name: 'Claw', scopes: ['write:meetings'] });
    mockPrisma.cycle.findFirst.mockResolvedValue({ id: 'cycle-1' } as never);
    mockPrisma.meeting.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }] as never);
    mockPrisma.meeting.findUnique.mockImplementation((async ({ where }: any) => ({
      id: where.id, cycleId: 'cycle-1', status: 'completed', revenue: 0, instructorPayment: 120, profit: -120,
      scheduledDate: new Date('2026-09-10T00:00:00Z'), cycle: { id: 'cycle-1', type: 'group' },
    })) as any);
    mockPrisma.billingPeriodMeeting.findFirst.mockResolvedValue(null as never); // not invoiced
    mockPrisma.meetingExpense.aggregate.mockResolvedValue({ _sum: { amount: 30 } } as never);
    mockPrisma.meeting.update.mockImplementation((async ({ where, data }: any) => ({ id: where.id, ...data })) as any);

    const res = await request(app)
      .post('/api/v1/meetings/bulk-update')
      .set('X-API-Key', key)
      .send({ cycleId: 'cycle-1', statuses: ['completed'], data: { revenue: 500 } });

    expect(res.status).toBe(200);
    expect(res.body.data.errors).toBeUndefined();
    expect(res.body.data).toMatchObject({ success: true, updated: 2, matched: 2 });
    const data = mockPrisma.meeting.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ revenue: 500, instructorPayment: 120, profit: 350 });

    await flush();
    const meetingAudits = mockPrisma.auditLog.create.mock.calls
      .map((c: any) => c[0].data)
      .filter((d: any) => d.entity === 'Meeting');
    expect(meetingAudits).toHaveLength(2);
    expect(meetingAudits[0]).toMatchObject({ apiKeyId: 'k-m3', userId: null, userName: 'api-key:Claw' });
  });
});

describe('meetings bulk-update billing lock', () => {
  it('does not change money on a meeting that is in an issued (invoiced) billing period', async () => {
    const key = makeKey({ id: 'k-m4', name: 'Claw', scopes: ['write:meetings'] });
    mockPrisma.meeting.findUnique.mockResolvedValue({
      id: 'm9', cycleId: 'cycle-1', status: 'completed', revenue: 300, instructorPayment: 120, profit: 180,
      scheduledDate: new Date('2026-09-10T00:00:00Z'), cycle: { id: 'cycle-1', type: 'institutional_fixed' },
    } as never);
    mockPrisma.billingPeriodMeeting.findFirst.mockResolvedValue({ billingPeriod: { morningDocNumber: 1234 } } as never);

    const res = await request(app)
      .post('/api/v1/meetings/bulk-update')
      .set('X-API-Key', key)
      .send({ ids: ['m9'], data: { revenue: 500 } });

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(0);
    expect(res.body.data.errors[0]).toContain('1234');
    expect(mockPrisma.meeting.update).not.toHaveBeenCalled();
  });
});

// ── Rate limiting ────────────────────────────────────────────────────────────

describe('rate limiting', () => {
  it('a trusted API key is not throttled by the anonymous per-IP limit (100/h)', async () => {
    mockPrisma.payingBody.findMany.mockResolvedValue([] as never);
    mockPrisma.payingBody.count.mockResolvedValue(0 as never);
    const key = makeKey({ id: 'k-bulk', name: 'bulk', scopes: ['read:paying_bodies'], rateLimit: 5000 });
    let last = 0;
    for (let i = 0; i < 130; i++) {
      const res = await request(app).get('/api/v1/paying-bodies').set('X-API-Key', key);
      last = res.status;
      if (res.status !== 200) break;
    }
    expect(last).toBe(200);
  });

  it('enforces the per-key limit', async () => {
    mockPrisma.payingBody.findMany.mockResolvedValue([] as never);
    mockPrisma.payingBody.count.mockResolvedValue(0 as never);
    const key = makeKey({ id: 'k-small', name: 'small', scopes: ['read:paying_bodies'], rateLimit: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await request(app).get('/api/v1/paying-bodies').set('X-API-Key', key)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
