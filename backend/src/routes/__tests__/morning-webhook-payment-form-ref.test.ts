import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../utils/prisma.js', () => ({ prisma: {} }));
vi.mock('../../services/notifications.js', () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock('../../services/trial-placement.js', () => ({ handlePostPaymentPlacement: vi.fn() }));
vi.mock('../../services/omer-payment-reconciliation.js', () => ({ reconcileOmerRegistrationPayment: vi.fn() }));
vi.mock('../../services/lead-payment-evidence.js', () => ({ autoConvertLeadsForPayment: vi.fn() }));
vi.mock('../../services/morning-receipt-sync.js', () => ({
  processMorningReceipt: vi.fn(async () => ({ outcome: 'no_customer' })),
  RECEIPT_DOC_TYPES: [305, 315, 320],
}));
vi.mock('../../services/morning-payment-link.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/morning-payment-link.js')>()),
  settleMorningPaymentByRef: vi.fn(),
}));

import { morningWebhookRouter } from '../morning-webhook.js';
import { processMorningReceipt } from '../../services/morning-receipt-sync.js';
import { settleMorningPaymentByRef } from '../../services/morning-payment-link.js';

const app = express();
app.use(express.json());
app.use('/api/morning-webhook', morningWebhookRouter);

const doc = {
  id: 'doc-1',
  type: 320,
  number: 70001,
  date: '2026-11-12',
  total: 999,
  description: 'רישום למחזור רובלוקס · הזמנה HT-ABCDEF1234',
  recipient: { name: 'הורה', phone: '0501234567' },
};

describe('Morning account webhook → CRM payment-link documents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands documents carrying an HT- ref to the payment-link settler (by id, re-verified there)', async () => {
    vi.mocked(settleMorningPaymentByRef).mockResolvedValue({ outcome: 'paid', paymentId: 'pay-1' });
    const res = await request(app).post('/api/morning-webhook').send(doc);
    expect(res.status).toBe(200);
    expect(settleMorningPaymentByRef).toHaveBeenCalledWith('HT-ABCDEF1234', 'doc-1');
    expect(processMorningReceipt).not.toHaveBeenCalled();
    expect(res.body.paymentForm).toBe('paid');
  });

  it('falls through to the regular receipt flow when no CRM payment owns the ref', async () => {
    vi.mocked(settleMorningPaymentByRef).mockResolvedValue({ outcome: 'not_found' });
    await request(app).post('/api/morning-webhook').send(doc);
    expect(processMorningReceipt).toHaveBeenCalled();
  });
});
