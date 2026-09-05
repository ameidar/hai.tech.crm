import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    customer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../trial-placement.js', () => ({
  handlePostPaymentPlacement: vi.fn(),
}));

vi.mock('../omer-payment-reconciliation.js', () => ({
  reconcileOmerRegistrationPayment: vi.fn(),
}));

vi.mock('../morning/clients.js', () => ({
  findClientForCustomer: vi.fn(),
  createMorningClient: vi.fn(),
}));

vi.mock('../morning/documents.js', () => ({
  DOCUMENT_TYPES: {
    TAX_INVOICE: 305,
    TAX_INVOICE_RECEIPT: 320,
    RECEIPT: 400,
  },
  searchMorningDocuments: vi.fn(),
}));

import { prisma } from '../../utils/prisma.js';
import { createMorningClient, findClientForCustomer } from '../morning/clients.js';
import { searchMorningDocuments } from '../morning/documents.js';
import { handlePostPaymentPlacement } from '../trial-placement.js';
import { reconcileOmerRegistrationPayment } from '../omer-payment-reconciliation.js';
import { syncRecentWooPayments, upsertWooOrderPayment } from '../woo-sync.js';

const mockPrisma = vi.mocked(prisma);
const mockPlacement = vi.mocked(handlePostPaymentPlacement);
const mockReconcileOmerRegistrationPayment = vi.mocked(reconcileOmerRegistrationPayment);
const mockFindMorningClient = vi.mocked(findClientForCustomer);
const mockCreateMorningClient = vi.mocked(createMorningClient);
const mockSearchMorningDocuments = vi.mocked(searchMorningDocuments);

describe('Woo payment sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WOO_SITE_URL = 'https://woo.test';
    process.env.WOO_CONSUMER_KEY = 'ck_test';
    process.env.WOO_CONSUMER_SECRET = 'cs_test';
    mockReconcileOmerRegistrationPayment.mockResolvedValue({ status: 'skipped', reason: 'no_matching_registration' } as any);
    mockSearchMorningDocuments.mockResolvedValue({ items: [], total: 0 });
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 'customer-id',
      name: 'Existing Customer',
      email: 'buyer@example.com',
      phone: null,
      address: null,
      city: null,
      morningClientId: 'morning-client-id',
    } as any);
  });

  it('skips a new pending order instead of creating a premature payment', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);

    const result = await upsertWooOrderPayment({
      id: 40423,
      status: 'pending',
      total: '497',
      billing: { email: 'buyer@example.com' },
    });

    expect(result).toEqual({ action: 'skipped_pending', orderId: 40423 });
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it('creates a missing paid Woo order and links an existing CRM customer by email', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'customer-id',
      name: 'Existing Customer',
      email: 'buyer@example.com',
    } as any);
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-id' } as any);

    const result = await upsertWooOrderPayment({
      id: 40423,
      status: 'on-hold',
      total: '497',
      date_modified: '2026-07-07T13:48:03',
      payment_method: 'greeninvoice-creditcard',
      billing: { first_name: 'Gilad', last_name: 'Steinberg LTD', email: 'buyer@example.com', phone: '' },
      fee_lines: [{ name: 'קורס מיינקראפט + JavaScript' }],
    });

    expect(result).toMatchObject({ action: 'created', orderId: 40423, paymentId: 'payment-id' });
    expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({ where: { email: 'buyer@example.com' } });
    expect(mockPrisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        wooOrderId: 40423,
        amount: 497,
        description: 'קורס מיינקראפט + JavaScript',
        status: 'paid',
        paymentMethod: 'greeninvoice-creditcard',
        customerName: 'Gilad Steinberg LTD',
        customerEmail: 'buyer@example.com',
        customerId: 'customer-id',
      }),
    });
    expect(mockPlacement).not.toHaveBeenCalled();
    expect(mockReconcileOmerRegistrationPayment).toHaveBeenCalledWith('payment-id');
  });

  it('creates and stores a Morning client for a paid Woo order customer when missing', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'customer-id',
      name: 'Razan Assad',
      email: 'razan@example.com',
    } as any);
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 'customer-id',
      name: 'Razan Assad',
      email: 'razan@example.com',
      phone: '0501234567',
      address: null,
      city: null,
      morningClientId: null,
    } as any);
    mockFindMorningClient.mockResolvedValue(null);
    mockCreateMorningClient.mockResolvedValue({ id: 'morning-razan-id', name: 'Razan Assad' } as any);
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-id' } as any);

    const result = await upsertWooOrderPayment({
      id: 40555,
      status: 'completed',
      total: '497',
      date_paid: '2026-08-24T15:12:00',
      payment_method: 'greeninvoice-creditcard',
      billing: {
        first_name: 'Razan',
        last_name: 'Assad',
        email: 'razan@example.com',
        phone: '0501234567',
      },
      line_items: [{ name: 'קורס דיגיטלי' }],
    });

    expect(result).toMatchObject({ action: 'created', orderId: 40555, paymentId: 'payment-id' });
    expect(mockCreateMorningClient).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Razan Assad',
      emails: ['razan@example.com'],
      phone: '0501234567',
    }));
    expect(mockPrisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-id' },
      data: { morningClientId: 'morning-razan-id' },
    });
    expect(mockPrisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceUrl: undefined,
        invoiceNumber: undefined,
        customerId: 'customer-id',
      }),
    });
  });

  it('fills a paid Woo payment invoice from a single clear Morning document match when Woo has no invoice data', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'customer-id',
      name: 'Razan Assad',
      email: 'razan@example.com',
    } as any);
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-id' } as any);
    mockSearchMorningDocuments
      .mockResolvedValueOnce({
        total: 1,
        items: [{
          id: 'morning-doc-id',
          number: 65243,
          type: 320,
          documentDate: '2026-08-24',
          status: 1,
          amount: 497,
          url: { he: 'https://app.greeninvoice.co.il/incomes/documents/morning-doc-id' },
          client: { name: 'Razan Assad', emails: ['razan@example.com'], phone: '0501234567' },
        }],
      } as any)
      .mockResolvedValue({ total: 0, items: [] });

    const result = await upsertWooOrderPayment({
      id: 40543,
      status: 'completed',
      total: '497',
      date_paid: '2026-08-24T15:12:00',
      payment_method: 'greeninvoice-creditcard',
      billing: {
        first_name: 'Razan',
        last_name: 'Assad',
        email: 'razan@example.com',
        phone: '0501234567',
      },
      line_items: [{ name: 'קורס דיגיטלי' }],
    });

    expect(result).toEqual({
      action: 'created',
      orderId: 40543,
      paymentId: 'payment-id',
      invoiceUrl: 'https://app.greeninvoice.co.il/incomes/documents/morning-doc-id',
      invoiceNumber: '65243',
      invoiceSource: 'morning-search',
    });
    expect(mockPrisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        wooOrderId: 40543,
        invoiceUrl: 'https://app.greeninvoice.co.il/incomes/documents/morning-doc-id',
        invoiceNumber: '65243',
      }),
    });
  });

  it('leaves invoice fields empty when Morning search has more than one clear match', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'customer-id' } as any);
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-id' } as any);
    mockSearchMorningDocuments
      .mockResolvedValueOnce({
        total: 2,
        items: [
          {
            id: 'morning-doc-1',
            number: 65243,
            type: 320,
            documentDate: '2026-08-24',
            status: 1,
            amount: 497,
            client: { name: 'Razan Assad', emails: ['razan@example.com'] },
          },
          {
            id: 'morning-doc-2',
            number: 65244,
            type: 320,
            documentDate: '2026-08-24',
            status: 1,
            amount: 497,
            client: { name: 'Razan Assad', emails: ['razan@example.com'] },
          },
        ],
      } as any)
      .mockResolvedValue({ total: 0, items: [] });

    const result = await upsertWooOrderPayment({
      id: 40544,
      status: 'completed',
      total: '497',
      date_paid: '2026-08-24T15:12:00',
      billing: {
        first_name: 'Razan',
        last_name: 'Assad',
        email: 'razan@example.com',
      },
    });

    expect(result).toMatchObject({
      action: 'created',
      orderId: 40544,
      paymentId: 'payment-id',
      invoiceUrl: null,
      invoiceNumber: null,
      invoiceSource: null,
    });
    expect(mockPrisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceUrl: undefined,
        invoiceNumber: undefined,
      }),
    });
  });

  it('links an existing paid payment to CRM and Morning customers when customerId is missing', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue({
      id: 'existing-payment-id',
      customerId: null,
      invoiceUrl: null,
    } as any);
    mockPrisma.customer.findFirst.mockResolvedValue(null);
    mockPrisma.customer.create.mockResolvedValue({ id: 'created-customer-id', name: 'Razan Assad' } as any);
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 'created-customer-id',
      name: 'Razan Assad',
      email: 'razan@example.com',
      phone: '0501234567',
      address: null,
      city: null,
      morningClientId: null,
    } as any);
    mockFindMorningClient.mockResolvedValue(null);
    mockCreateMorningClient.mockResolvedValue({ id: 'morning-razan-id', name: 'Razan Assad' } as any);

    const result = await upsertWooOrderPayment({
      id: 40556,
      status: 'completed',
      total: '497',
      date_paid: '2026-08-24T15:12:00',
      payment_method: 'greeninvoice-creditcard',
      billing: {
        first_name: 'Razan',
        last_name: 'Assad',
        email: 'razan@example.com',
        phone: '0501234567',
      },
      meta_data: [{ key: 'greeninvoice_data', value: { id: 'doc-id', number: '12345' } }],
      line_items: [{ name: 'קורס דיגיטלי' }],
    });

    expect(result).toMatchObject({ action: 'updated', orderId: 40556, paymentId: 'existing-payment-id' });
    expect(mockPrisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'existing-payment-id' },
      data: expect.objectContaining({
        customerId: 'created-customer-id',
        customerName: 'Razan Assad',
        customerEmail: 'razan@example.com',
        customerPhone: '0501234567',
        invoiceUrl: 'https://app.greeninvoice.co.il/incomes/documents/doc-id',
        invoiceNumber: '12345',
        status: 'paid',
      }),
    });
    expect(mockPrisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'created-customer-id' },
      data: { morningClientId: 'morning-razan-id' },
    });
  });

  it('backup sync scans recent paid Woo orders and creates missing payments', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'customer-id' } as any);
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-id' } as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 40423,
        status: 'on-hold',
        total: '497',
        billing: { email: 'buyer@example.com' },
        fee_lines: [{ name: 'קורס מיינקראפט + JavaScript' }],
      }],
    }));

    const result = await syncRecentWooPayments(1);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/wp-json/wc/v3/orders?'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }) })
    );
    expect(result).toMatchObject({ ok: true, created: 1, updated: 0, skipped: 0, failed: 0, total: 1, days: 1 });
  });
});
