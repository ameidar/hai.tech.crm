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
vi.mock('../../services/morning-payment-link.js', () => ({
  extractMorningRef: vi.fn(() => null),
  settleMorningPaymentByRef: vi.fn(),
}));
vi.mock('../../services/morning-credit-notes.js', () => ({
  CREDIT_NOTE_DOC_TYPE: 330,
  applyMorningCreditNote: vi.fn(async () => ({
    outcome: 'refunded', paymentIds: ['pay-1'], registrationIds: [], billingMatches: [],
  })),
}));

import { morningWebhookRouter } from '../morning-webhook.js';
import { processMorningReceipt } from '../../services/morning-receipt-sync.js';
import { applyMorningCreditNote } from '../../services/morning-credit-notes.js';

const app = express();
app.use(express.json());
app.use('/api/morning-webhook', morningWebhookRouter);

const creditNote = {
  id: 'credit-1',
  type: 330,
  number: 50012,
  date: '2026-11-14',
  total: 2980,
  recipient: { name: 'הורה' },
  linkedDocuments: [{ id: 'orig-1', type: 320, number: 65297, amount: 2980 }],
};

describe('Morning webhook → credit notes (330)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes credit notes to applyMorningCreditNote (with linkedDocuments) instead of ignoring them', async () => {
    const res = await request(app).post('/api/morning-webhook').send(creditNote);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, creditNote: 'refunded' });
    expect(applyMorningCreditNote).toHaveBeenCalledWith(expect.objectContaining({
      id: 'credit-1',
      number: 50012,
      type: 330,
      amount: 2980,
      documentDate: '2026-11-14',
      linkedDocuments: creditNote.linkedDocuments,
    }));
    expect(processMorningReceipt).not.toHaveBeenCalled();
  });

  it('passes undefined linkedDocuments when the payload lacks them (service fetches the doc)', async () => {
    const { linkedDocuments: _omit, ...bare } = creditNote;
    await request(app).post('/api/morning-webhook').send(bare);
    expect(vi.mocked(applyMorningCreditNote).mock.calls[0][0].linkedDocuments).toBeUndefined();
  });

  it('still processes receipts through the receipt flow', async () => {
    await request(app).post('/api/morning-webhook').send({ ...creditNote, type: 320 });
    expect(applyMorningCreditNote).not.toHaveBeenCalled();
    expect(processMorningReceipt).toHaveBeenCalled();
  });
});
