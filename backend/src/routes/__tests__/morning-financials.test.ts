import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.TZ = 'Asia/Jerusalem';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-id', role: 'admin' };
    next();
  },
  managerOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../utils/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../../utils/prodPrisma.js', () => ({
  prodPrisma: {
    meeting: {
      findMany: vi.fn(),
    },
    billingPeriod: {
      findMany: vi.fn(),
    },
    institutionalOrder: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../services/instructor-payment.js', () => ({
  calculateInstructorPayment: vi.fn(),
}));

vi.mock('../../services/billing.js', () => ({
  buildProformaSnapshotFromMorningDocument: vi.fn(),
}));

vi.mock('../../services/morning/documents.js', () => ({
  DOCUMENT_TYPES: { PROFORMA: 300 },
  createDocument: vi.fn(),
  previewDocument: vi.fn(),
  getMorningDocument: vi.fn(),
}));

vi.mock('../../services/morning/client.js', () => ({
  isMorningConfigured: vi.fn(() => true),
  morningRequest: vi.fn(),
}));

import { morningRouter } from '../morning.js';
import { morningRequest } from '../../services/morning/client.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const mockMorningRequest = vi.mocked(morningRequest);

const app = express();
app.use(express.json());
app.use('/api/morning', morningRouter);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  mockMorningRequest.mockImplementation(async (_method, _path, body: any) => {
    if (body.type?.includes(330)) {
      return { items: [], total: 0 };
    }

    return {
      items: [
        {
          documentDate: '2026-05-31',
          type: 305,
          number: 100,
          status: 1,
          client: { name: 'May client' },
          amountExcludeVat: 80000,
        },
        {
          documentDate: '2026-06-01',
          type: 305,
          number: 101,
          status: 1,
          client: { name: 'June client' },
          amountExcludeVat: 160000,
        },
      ],
      total: 2,
    };
  });
});

describe('GET /api/morning/financials/details', () => {
  it('uses calendar month boundaries and filters income rows to the requested month', async () => {
    const res = await request(app).get('/api/morning/financials/details?month=2026-06&category=income');

    expect(res.status).toBe(200);
    expect(mockMorningRequest).toHaveBeenCalledWith(
      'POST',
      '/api/v1/documents/search',
      expect.objectContaining({
        fromDate: '2026-06-01',
        toDate: '2026-06-30',
        type: [305, 320, 400],
      }),
    );
    expect(res.body.items).toEqual([
      expect.objectContaining({
        date: '2026-06-01',
        number: '101',
        amount: 160000,
      }),
    ]);
  });
});
