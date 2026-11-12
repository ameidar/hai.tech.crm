import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../config.js', () => ({
  config: {
    apiKey: 'test-api-key',
    woo: { siteUrl: 'https://woo.test', consumerKey: 'ck', consumerSecret: 'cs' },
    morning: { apiKeyId: 'id', apiSecret: 'secret', baseUrl: 'https://api.greeninvoice.co.il' },
  },
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    customer: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    payment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../services/morning/payment-forms.js', () => ({ createPaymentForm: vi.fn() }));
vi.mock('../../services/morning/documents.js', () => ({
  getMorningDocument: vi.fn(),
  searchMorningDocuments: vi.fn(),
  DOCUMENT_TYPES: { TAX_INVOICE: 305, TAX_INVOICE_RECEIPT: 320, RECEIPT: 400 },
}));
vi.mock('../../services/morning/clients.js', () => ({
  findClientForCustomer: vi.fn(),
  createMorningClient: vi.fn(),
}));
vi.mock('../../services/trial-placement.js', () => ({ handlePostPaymentPlacement: vi.fn() }));
vi.mock('../../services/omer-payment-reconciliation.js', () => ({ reconcileOmerRegistrationPayment: vi.fn() }));
vi.mock('../../services/lead-payment-evidence.js', () => ({ autoConvertLeadsForPayment: vi.fn() }));

import { prisma } from '../../utils/prisma.js';
import { createPaymentForm } from '../../services/morning/payment-forms.js';
import { getMorningDocument, searchMorningDocuments } from '../../services/morning/documents.js';
import { reconcileOmerRegistrationPayment } from '../../services/omer-payment-reconciliation.js';
import { autoConvertLeadsForPayment } from '../../services/lead-payment-evidence.js';
import { handlePostPaymentPlacement } from '../../services/trial-placement.js';
import { paymentsRouter } from '../payments.js';
import {
  extractMorningRef,
  morningRefForToken,
  settleMorningPaymentByRef,
} from '../../services/morning-payment-link.js';

const db = vi.mocked(prisma, true);
const mockForm = vi.mocked(createPaymentForm);
const mockGetDoc = vi.mocked(getMorningDocument);
const mockSearch = vi.mocked(searchMorningDocuments);

const app = express();
app.use(express.json());
app.use('/api/payments', paymentsRouter);

const TOKEN = 'abcdef12-3456-4789-8abc-def012345678';
const REF = 'HT-ABCDEF1234';

function pendingPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    payToken: TOKEN,
    wooOrderId: null,
    wooOrderKey: null,
    customerId: null,
    customerName: 'הורה בדיקה',
    customerEmail: 'parent@example.com',
    customerPhone: '0501234567',
    description: 'רישום למחזור רובלוקס',
    amount: 999,
    currency: 'ILS',
    status: 'pending',
    maxInstallments: 3,
    invoiceUrl: null,
    invoiceNumber: null,
    createdAt: new Date('2026-11-12T08:00:00Z'),
    ...overrides,
  };
}

function morningDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-uuid-1',
    number: 50123,
    type: 320,
    status: 1,
    documentDate: '2026-11-12',
    amount: 999,
    description: `רישום למחזור רובלוקס · הזמנה ${REF}`,
    remarks: `הזמנה ${REF}`,
    url: { he: 'https://www.greeninvoice.co.il/api/v1/documents/download?d=x' },
    client: { name: 'הורה בדיקה', emails: ['parent@example.com'] },
    ...overrides,
  } as any;
}

describe('Morning payment ref helpers', () => {
  it('derives a stable ref from the pay token and parses it back out of document text', () => {
    expect(morningRefForToken(TOKEN)).toBe(REF);
    expect(extractMorningRef('קורס פייתון · הזמנה ht-abcdef1234')).toBe(REF);
    expect(extractMorningRef('no ref here', undefined)).toBeNull();
    // website / LMS worker refs use base32 (A-Z, 2-9)
    expect(extractMorningRef('קורס · הזמנה HT-AB2CD3EF4G')).toBe('HT-AB2CD3EF4G');
  });

  it('does not look up CRM payments for website (non-hex) refs', async () => {
    vi.clearAllMocks();
    const r = await settleMorningPaymentByRef('HT-ZZ2CD3EF4G', 'doc-x');
    expect(r.outcome).toBe('not_found');
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });

  it('settles by ref using the pay-token prefix', async () => {
    db.payment.findMany.mockResolvedValue([{ payToken: TOKEN }] as any);
    db.payment.findUnique.mockResolvedValue(pendingPayment({ status: 'paid' }) as any);
    const r = await settleMorningPaymentByRef(REF, 'doc-uuid-1');
    expect(db.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { payToken: { startsWith: 'abcdef12-34' }, wooOrderId: null },
    }));
    expect(r.outcome).toBe('already_paid');
  });
});

describe('payments — Morning provider (default)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PAYMENTS_PROVIDER;
    delete process.env.MORNING_PAYMENT_DOC_TYPE;
    process.env.BASE_URL = 'https://crm.test';
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network in tests (Woo must not be called)'); }));
    db.payment.findFirst.mockResolvedValue(null);
    db.payment.updateMany.mockResolvedValue({ count: 1 } as any);
    db.customer.findFirst.mockResolvedValue(null);
    db.customer.create.mockResolvedValue({ id: 'cust-new' } as any);
  });

  it('create-link stores a pending Morning payment and returns the CRM pay page (no Woo call)', async () => {
    db.payment.create.mockImplementation(async ({ data }: any) => ({ id: 'pay-1', ...data }));

    const res = await request(app).post('/api/payments/create-link').send({
      customerName: 'הורה בדיקה',
      customerPhone: '',
      customerEmail: 'parent@example.com',
      amount: 999,
      description: 'רישום למחזור רובלוקס',
      installments: 3,
    });

    expect(res.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    const data = (db.payment.create.mock.calls[0][0] as any).data;
    expect(data).toEqual(expect.objectContaining({
      status: 'pending',
      amount: 999,
      paymentMethod: 'morning_payment_form',
      maxInstallments: 3,
    }));
    expect(data.wooOrderId).toBeUndefined();
    expect(res.body.provider).toBe('morning');
    expect(res.body.orderId).toBe('pay-1');
    expect(res.body.paymentUrl).toBe(`https://crm.test/pay/${data.payToken}`);
  });

  it('pay-page confirm creates a Morning payment form with ref, notify/success URLs and VAT-inclusive income', async () => {
    db.payment.findUnique.mockResolvedValue(pendingPayment({ customerId: 'cust-1' }) as any);
    db.customer.findUnique.mockResolvedValue({ id: 'cust-1', name: 'הורה', morningClientId: 'mc-1' } as any);
    mockForm.mockResolvedValue({ success: true, errorCode: 0, url: 'https://pay.morning.test/f/1' });

    const res = await request(app).post(`/api/payments/pay-page/${TOKEN}/confirm`).send({ installments: 12 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checkoutUrl: 'https://pay.morning.test/f/1', installments: 3 });
    const input = mockForm.mock.calls[0][0];
    expect(input).toEqual(expect.objectContaining({
      description: `רישום למחזור רובלוקס · הזמנה ${REF}`,
      amount: 999,
      maxPayments: 3, // capped to the link's maxInstallments
      type: 320,
      custom: REF,
      notifyUrl: `https://crm.test/api/payments/morning-notify/${TOKEN}`,
      successUrl: `https://crm.test/pay/${TOKEN}?paid=1`,
      failureUrl: `https://crm.test/pay/${TOKEN}?failed=1`,
    }));
    expect(input.client.id).toBe('mc-1');
    expect(input.income).toEqual([{ description: 'רישום למחזור רובלוקס', quantity: 1, price: 999, currency: 'ILS', vatType: 1 }]);
  });

  it('pay-page confirm returns a Hebrew 502 when Morning refuses the form', async () => {
    db.payment.findUnique.mockResolvedValue(pendingPayment() as any);
    mockForm.mockResolvedValue({ success: false, errorCode: 1003, errorDescription: 'bad plugin', url: '' } as any);
    const res = await request(app).post(`/api/payments/pay-page/${TOKEN}/confirm`).send({ installments: 1 });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('שגיאה');
  });

  it('notify: verifies the document via the Morning API and marks the payment paid once', async () => {
    db.payment.findUnique.mockResolvedValue(pendingPayment() as any);
    mockGetDoc.mockResolvedValue(morningDoc());

    const res = await request(app).post(`/api/payments/morning-notify/${TOKEN}`).send({ id: 'doc-uuid-1', anything: 'untrusted' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('paid');
    expect(mockGetDoc).toHaveBeenCalledWith('doc-uuid-1');
    const upd = db.payment.updateMany.mock.calls[0][0] as any;
    expect(upd.where).toEqual({ id: 'pay-1', status: { not: 'paid' } });
    expect(upd.data).toEqual(expect.objectContaining({
      status: 'paid',
      paymentMethod: 'morning_payment_form',
      invoiceNumber: '50123',
      customerId: 'cust-new',
      description: 'רישום למחזור רובלוקס [morning-doc:doc-uuid-1]',
    }));
    expect(reconcileOmerRegistrationPayment).toHaveBeenCalledWith('pay-1');
    expect(autoConvertLeadsForPayment).toHaveBeenCalledWith('pay-1');
    expect(handlePostPaymentPlacement).toHaveBeenCalledWith('pay-1');
  });

  it('notify: rejects a document whose amount does not match (no update, still 2xx)', async () => {
    db.payment.findUnique.mockResolvedValue(pendingPayment() as any);
    mockGetDoc.mockResolvedValue(morningDoc({ amount: 1 }));
    mockSearch.mockResolvedValue({ items: [], total: 0 });

    const res = await request(app).post(`/api/payments/morning-notify/${TOKEN}`).send({ id: 'doc-uuid-1' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('no_document');
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('notify: rejects a document that does not carry this payment ref', async () => {
    db.payment.findUnique.mockResolvedValue(pendingPayment() as any);
    mockGetDoc.mockResolvedValue(morningDoc({ description: 'משהו אחר · הזמנה HT-0000000000', remarks: '' }));
    mockSearch.mockResolvedValue({ items: [], total: 0 });

    const res = await request(app).post(`/api/payments/morning-notify/${TOKEN}`).send({ documentId: 'doc-uuid-1' });

    expect(res.body.outcome).toBe('no_document');
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('notify: without a document id in the body, finds the document by searching for the ref', async () => {
    db.payment.findUnique.mockResolvedValue(pendingPayment() as any);
    mockSearch.mockResolvedValueOnce({ items: [morningDoc()], total: 1 });

    const res = await request(app).post(`/api/payments/morning-notify/${TOKEN}`).type('form').send('foo=bar');

    expect(res.body.outcome).toBe('paid');
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({
      description: REF,
      type: [305, 320, 400],
      fromDate: '2026-11-11',
    }));
  });

  it('notify: already-paid payments are not re-verified or updated', async () => {
    db.payment.findUnique.mockResolvedValue(pendingPayment({ status: 'paid' }) as any);
    const res = await request(app).post(`/api/payments/morning-notify/${TOKEN}`).send({ id: 'doc-uuid-1' });
    expect(res.body.outcome).toBe('already_paid');
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('notify: a document already recorded on another payment is not reused', async () => {
    db.payment.findUnique.mockResolvedValue(pendingPayment() as any);
    mockGetDoc.mockResolvedValue(morningDoc());
    db.payment.findFirst.mockResolvedValue({ id: 'other-payment' } as any);

    const res = await request(app).post(`/api/payments/morning-notify/${TOKEN}`).send({ id: 'doc-uuid-1' });

    expect(res.body.outcome).toBe('document_used_elsewhere');
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('notify: unknown token answers 2xx without touching Morning', async () => {
    db.payment.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/payments/morning-notify/nope').send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('not_found');
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it('order-status with a CRM payment id verifies with Morning and reports paid', async () => {
    db.payment.findUnique
      .mockResolvedValueOnce(pendingPayment() as any) // order-status lookup by id
      .mockResolvedValueOnce(pendingPayment() as any) // settle lookup by token
      .mockResolvedValueOnce(pendingPayment({ status: 'paid', invoiceUrl: 'https://doc', invoiceNumber: '50123' }) as any);
    mockSearch.mockResolvedValueOnce({ items: [morningDoc()], total: 1 });

    const res = await request(app).get('/api/payments/order-status/pay-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ orderId: 'pay-1', paid: true, invoiceNumber: '50123', provider: 'morning' }));
  });

  it('pay-page GET hides the pay token and reports the provider', async () => {
    db.payment.findUnique.mockResolvedValue(pendingPayment() as any);
    const res = await request(app).get(`/api/payments/pay-page/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('morning');
    expect(res.body.payToken).toBeUndefined();
    expect(mockSearch).not.toHaveBeenCalled(); // no ?check=1 → no Morning call
  });

  describe('POST /morning/external', () => {
    const WEB_REF = 'HT-AB2CD3EF4G';
    const body = {
      documentId: 'doc-uuid-1',
      ref: WEB_REF,
      expectedAmount: 999,
      source: 'lms-course',
      description: 'קורס פייתון',
      cycleId: 'fc6fee2c-80b5-4120-a68c-5a207d1441be',
      customer: { name: 'תלמיד', email: 'kid@example.com', phone: '0501111111' },
    };

    it('requires the CRM API key', async () => {
      const res = await request(app).post('/api/payments/morning/external').send(body);
      expect(res.status).toBe(401);
      expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it('re-verifies the document and records an idempotent paid payment', async () => {
      mockGetDoc.mockResolvedValue(morningDoc({ description: `קורס פייתון · הזמנה ${WEB_REF}`, remarks: '' }));
      db.payment.create.mockResolvedValue({ id: 'pay-ext' } as any);

      const res = await request(app).post('/api/payments/morning/external').set('x-api-key', 'test-api-key').send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ ok: true, outcome: 'created', paymentId: 'pay-ext' }));
      const data = (db.payment.create.mock.calls[0][0] as any).data;
      expect(data).toEqual(expect.objectContaining({
        status: 'paid',
        amount: 999,
        paymentMethod: 'morning_payment_form',
        customerId: 'cust-new',
        description: 'קורס פייתון [cycle:fc6fee2c-80b5-4120-a68c-5a207d1441be] [source:lms-course] [morning-doc:doc-uuid-1]',
      }));
    });

    it('does not create a second payment for the same document', async () => {
      mockGetDoc.mockResolvedValue(morningDoc({ description: `קורס פייתון · הזמנה ${WEB_REF}` }));
      db.payment.findFirst.mockResolvedValue({ id: 'pay-ext' } as any);
      const res = await request(app).post('/api/payments/morning/external').set('x-api-key', 'test-api-key').send(body);
      expect(res.body.outcome).toBe('duplicate');
      expect(db.payment.create).not.toHaveBeenCalled();
    });

    it('404s when Morning has no matching document', async () => {
      mockGetDoc.mockRejectedValue(new Error('404'));
      mockSearch.mockResolvedValue({ items: [], total: 0 });
      const res = await request(app).post('/api/payments/morning/external').set('x-api-key', 'test-api-key').send(body);
      expect(res.status).toBe(404);
      expect(db.payment.create).not.toHaveBeenCalled();
    });
  });
});
