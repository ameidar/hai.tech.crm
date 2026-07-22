import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { createSchema, updateSchema, isComplete } from '../src/routes/paying-bodies.js';

vi.mock('../src/utils/prisma.js', () => ({
  prisma: {
    payingBody: {
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'ariel-id', email: 'arielmeidar23@gmail.com', role: 'operations_manager' };
    next();
  },
  managerOrAdmin: (req: any, res: any, next: any) => {
    if (req.user?.role === 'admin' || req.user?.role === 'manager') return next();
    return res.status(403).json({ message: 'Insufficient permissions' });
  },
}));

vi.mock('../src/utils/audit.js', () => ({
  logAudit: vi.fn(),
  logUpdateAudit: vi.fn(),
}));

vi.mock('../src/services/morning/client.js', () => ({
  isMorningConfigured: vi.fn(() => false),
}));

vi.mock('../src/services/morning/clients.js', () => ({
  searchClients: vi.fn(),
  getMorningClient: vi.fn(),
  updateMorningClient: vi.fn(),
}));

vi.mock('../src/services/payingBodySync.js', () => ({
  comparePayingBodyToMorning: vi.fn(),
  planSync: vi.fn(),
}));

import { payingBodiesRouter } from '../src/routes/paying-bodies.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api/paying-bodies', payingBodiesRouter);
app.use(errorHandler);

// Required fields (decided with Inna): name, taxId (ח.פ/ת.ז), contactName, email.
// Phone + address fields are optional. Enforcement is on create only — legacy
// rows are completed gradually via the all-optional update schema.
describe('paying-body createSchema (required fields)', () => {
  it('accepts a complete paying body', () => {
    const result = createSchema.safeParse({
      name: 'עיריית באר שבע',
      taxId: '500001234',
      contactName: 'אינה גרויס',
      email: 'inna@example.com',
      phone: '0501234567',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when taxId is missing', () => {
    const result = createSchema.safeParse({
      name: 'עיריית באר שבע',
      contactName: 'אינה גרויס',
      email: 'inna@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when contactName is missing', () => {
    const result = createSchema.safeParse({
      name: 'עיריית באר שבע',
      taxId: '500001234',
      email: 'inna@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email on create', () => {
    const result = createSchema.safeParse({
      name: 'עיריית באר שבע',
      taxId: '500001234',
      contactName: 'אינה גרויס',
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('trims whitespace and rejects whitespace-only required fields', () => {
    const result = createSchema.safeParse({
      name: '   ',
      taxId: '500001234',
      contactName: 'אינה גרויס',
      email: 'inna@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('keeps morningClientId when linking an existing Morning client', () => {
    const result = createSchema.safeParse({
      name: 'עיריית באר שבע',
      taxId: '500001234',
      contactName: 'אינה גרויס',
      email: 'inna@example.com',
      morningClientId: 'abc123',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.morningClientId).toBe('abc123');
  });
});

// On update every field is optional so an incomplete legacy row can be
// completed one field at a time.
describe('paying-body updateSchema (all-optional, transition)', () => {
  it('accepts a partial update (just a phone)', () => {
    const result = updateSchema.safeParse({ phone: '0501234567' });
    expect(result.success).toBe(true);
  });

  it('accepts clearing email with an empty string', () => {
    const result = updateSchema.safeParse({ email: '' });
    expect(result.success).toBe(true);
  });

  it('still rejects a malformed (non-empty) email on update', () => {
    const result = updateSchema.safeParse({ email: 'nope' });
    expect(result.success).toBe(false);
  });
});

// isComplete drives the "חסר השלמה" badge and flips a legacy row to complete
// once all four required fields are present.
describe('isComplete', () => {
  it('is true only when all required fields are present', () => {
    expect(
      isComplete({ name: 'X', taxId: '1', contactName: 'Y', email: 'a@b.com' }),
    ).toBe(true);
  });

  it('is false when any required field is missing', () => {
    expect(isComplete({ name: 'X', taxId: '1', contactName: 'Y', email: null })).toBe(false);
    expect(isComplete({ name: 'X', taxId: null, contactName: 'Y', email: 'a@b.com' })).toBe(false);
    expect(isComplete({ name: 'X' })).toBe(false);
  });
});

describe('paying bodies authorization', () => {
  it('blocks operations_manager from listing paying bodies', async () => {
    const res = await request(app).get('/api/paying-bodies');

    expect(res.status).toBe(403);
  });

  it('blocks operations_manager from reading a paying body', async () => {
    const res = await request(app).get('/api/paying-bodies/00000000-0000-0000-0000-000000000001');

    expect(res.status).toBe(403);
  });
});
