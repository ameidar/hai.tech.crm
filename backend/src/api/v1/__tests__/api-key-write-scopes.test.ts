/**
 * v1 write routes vs API-key scopes — a read-only key must be rejected (403) on every write route,
 * whatever its creator's role; user logins (JWT) keep their role-based access.
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
      webhook: model(),
      leadAppointment: model(),
      lead: model(),
      attendance: model(),
      registration: model(),
      branch: model(),
      course: model(),
      student: model(),
      customer: model(),
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


const ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const ID2 = 'a1b2c3d4-0000-4000-8000-000000000002';

// Every v1 write route (method, path). Bodies are irrelevant: the scope gate runs before validation.
const WRITE_ROUTES: Array<[string, string]> = [
  ['post', '/customers'], ['put', `/customers/${ID}`], ['delete', `/customers/${ID}`], ['post', `/customers/${ID}/students`],
  ['post', '/students'], ['put', `/students/${ID}`], ['delete', `/students/${ID}`],
  ['post', '/courses'], ['put', `/courses/${ID}`], ['delete', `/courses/${ID}`],
  ['post', '/branches'], ['put', `/branches/${ID}`], ['delete', `/branches/${ID}`],
  ['post', '/instructors'], ['put', `/instructors/${ID}`], ['delete', `/instructors/${ID}`],
  ['post', `/instructors/${ID}/fixed-additions`], ['put', `/instructors/${ID}/fixed-additions/${ID2}`], ['delete', `/instructors/${ID}/fixed-additions/${ID2}`],
  ['post', '/cycles'], ['put', `/cycles/${ID}`], ['delete', `/cycles/${ID}`], ['post', `/cycles/${ID}/registrations`],
  ['post', `/cycles/${ID}/generate-meetings`], ['post', `/cycles/${ID}/sync-progress`], ['post', `/cycles/${ID}/duplicate`], ['post', '/cycles/bulk-update'],
  ['post', '/meetings'], ['put', `/meetings/${ID}`], ['delete', `/meetings/${ID}`], ['post', `/meetings/${ID}/postpone`],
  ['post', `/meetings/${ID}/complete`], ['post', `/meetings/${ID}/cancel`], ['post', `/meetings/${ID}/recalculate`], ['post', `/meetings/${ID}/attendance/bulk`],
  ['post', '/meetings/bulk-update'], ['post', '/meetings/bulk-recalculate'], ['post', '/meetings/bulk-update-status'], ['post', '/meetings/bulk-delete'],
  ['post', '/registrations'], ['put', `/registrations/${ID}`], ['delete', `/registrations/${ID}`], ['post', `/registrations/${ID}/cancel`], ['post', `/registrations/${ID}/payment`],
  ['post', '/attendance'], ['put', `/attendance/${ID}`], ['delete', `/attendance/${ID}`], ['post', '/attendance/bulk'],
  ['patch', `/leads/${ID}`], ['post', `/leads/${ID}/activities`],
  ['post', '/institutional-orders'], ['put', `/institutional-orders/${ID}`],
  ['post', '/paying-bodies'], ['put', `/paying-bodies/${ID}`],
  ['put', '/bot-config'],
  ['post', '/api-keys'], ['put', `/api-keys/${ID}`], ['delete', `/api-keys/${ID}`],
  ['post', '/webhooks'], ['put', `/webhooks/${ID}`], ['delete', `/webhooks/${ID}`], ['post', `/webhooks/${ID}/test`],
];

function call(method: string, path: string, key: string) {
  return (request(app) as any)[method](`/api/v1${path}`).set('X-API-Key', key).send({});
}

function writeMocks() {
  return Object.values(mockPrisma as any).flatMap((m: any) =>
    m && typeof m === 'object' ? ['create', 'update', 'updateMany', 'delete'].map(k => m[k]).filter(Boolean) : []);
}

describe('read-only API keys are blocked on every v1 write route', () => {
  for (const creatorRole of ['admin', 'sales', 'viewer']) {
    it(`read:* key created by ${creatorRole} → 403 everywhere, nothing written`, async () => {
      const key = makeKey({ id: `k-ro-${creatorRole}`, name: 'ro', scopes: ['read:*'], creatorRole });
      const failures: string[] = [];
      for (const [method, path] of WRITE_ROUTES) {
        const res = await call(method, path, key);
        if (res.status !== 403) failures.push(`${method.toUpperCase()} ${path} → ${res.status}`);
      }
      await flush();
      expect(failures).toEqual([]);
      // apiKey.update (last-used stamp) and auditLog.create are bookkeeping, not data writes.
      const dataWrites = writeMocks().filter((fn: any) => fn !== mockPrisma.apiKey.update && fn !== mockPrisma.auditLog.create && fn.mock.calls.length > 0);
      expect(dataWrites).toHaveLength(0);
    });
  }
});

describe('scoped keys and user logins', () => {
  const token = (role: string) => jwt.sign({ userId: `u-${role}`, email: `${role}@x.com`, name: role, role }, config.jwt.secret);

  it('write:registrations key passes the registration gate even when its creator is a sales user', async () => {
    const key = makeKey({ id: 'k-reg', name: 'reg', scopes: ['read:*', 'write:registrations'], creatorRole: 'sales' });
    const res = await call('put', `/registrations/${ID}`, key);
    expect(res.status).not.toBe(403);
    // …but still nothing else
    expect((await call('put', `/meetings/${ID}`, key)).status).toBe(403);
    expect((await call('post', '/customers', key)).status).toBe(403);
  });

  it('write:registrations key created by a sales user still cannot use admin-only legacy routes', async () => {
    const key = makeKey({ id: 'k-reg2', name: 'reg2', scopes: ['write:registrations', 'write:courses'], creatorRole: 'sales' });
    expect((await call('post', '/courses', key)).status).toBe(403); // adminOnly by creator role remains
  });

  it('user logins keep role-based access (no scope gate for JWT)', async () => {
    const asManager = (await request(app).put(`/api/v1/registrations/${ID}`).set('Authorization', `Bearer ${token('manager')}`).send({}));
    expect(asManager.status).not.toBe(403);
    const asSales = (await request(app).put(`/api/v1/registrations/${ID}`).set('Authorization', `Bearer ${token('sales')}`).send({}));
    expect(asSales.status).toBe(403);
    const instructorMeeting = (await request(app).put(`/api/v1/meetings/${ID}`).set('Authorization', `Bearer ${token('instructor')}`).send({}));
    expect(instructorMeeting.status).not.toBe(403);
  });

  it('API keys cannot manage API keys or webhooks, even full-scope admin-created keys', async () => {
    const key = makeKey({ id: 'k-star2', name: 'star', scopes: ['*'], creatorRole: 'admin' });
    expect((await call('get', '/api-keys', key)).status).toBe(403);
    expect((await call('post', '/api-keys', key)).status).toBe(403);
    expect((await call('get', '/webhooks', key)).status).toBe(403);
    expect((await request(app).get('/api/v1/api-keys').set('Authorization', `Bearer ${token('admin')}`)).status).not.toBe(403);
  });
});
