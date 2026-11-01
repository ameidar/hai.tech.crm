import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({ prisma: {} }));
vi.mock('../../services/notifications.js', () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock('../../services/trial-placement.js', () => ({ handlePostPaymentPlacement: vi.fn() }));
vi.mock('../../services/omer-payment-reconciliation.js', () => ({ reconcileOmerRegistrationPayment: vi.fn() }));
vi.mock('../../services/morning-receipt-sync.js', () => ({ processMorningReceipt: vi.fn(), RECEIPT_DOC_TYPES: [305, 315, 320] }));

import { isBareMorningDocument, morningDocumentFromWebhook } from '../morning-webhook.js';

// Shape Morning actually posts (2026-11): bare document, client under `recipient`.
const payload = {
  id: 'fb0a9f70-bc6b-409e-afb5-a9f18991d91a',
  type: 320,
  number: 65274,
  date: '2026-11-01',
  total: 2980,
  description: 'קורס שנתי',
  recipient: { name: 'עודד שיר', phone: '050-1234567', emails: ['oded@example.com'] },
  items: [{ description: 'קורס שנתי', quantity: 1, price: 2980 }],
};

describe('Morning bare-document webhook payloads', () => {
  it('detects bare documents but not legacy event envelopes', () => {
    expect(isBareMorningDocument(payload)).toBe(true);
    expect(isBareMorningDocument({ event: 'document/created', data: payload })).toBe(false);
  });

  it('maps the payload to the API document shape', () => {
    expect(morningDocumentFromWebhook(payload)).toEqual(expect.objectContaining({
      id: payload.id,
      number: 65274,
      type: 320,
      documentDate: '2026-11-01',
      amount: 2980,
      client: { name: 'עודד שיר', phone: '050-1234567', mobile: undefined, emails: ['oded@example.com'] },
      income: [{ description: 'קורס שנתי', quantity: 1, price: 2980 }],
    }));
  });
});
