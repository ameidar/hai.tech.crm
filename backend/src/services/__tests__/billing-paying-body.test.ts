import { describe, it, expect } from 'vitest';
import { resolveMorningClient } from '../billing.js';

// Base legacy order with no linked paying body and no free-text payer. The PayingBody and
// free-text/order-id branches all return before any Morning network call, so they are
// deterministic to assert without mocking.
const baseOrder = {
  id: 'order-1',
  orderName: 'בית ספר אלון',
  branch: { name: 'סניף מרכז' },
  taxId: null,
  contactEmail: null,
  contactPhone: null,
  address: null,
  city: null,
  zip: null,
  payingBody: null,
  morningClientId: null,
};

const pb = (over: Record<string, unknown> = {}) => ({
  id: 'pb-1',
  name: 'עיריית חולון',
  taxId: '500200300',
  email: 'pay@holon.muni.il',
  phone: '03-1234567',
  address: 'ויצמן 58',
  city: 'חולון',
  zip: '5810201',
  morningClientId: null,
  ...over,
});

describe('resolveMorningClient — linked PayingBody is the source of truth', () => {
  it('bills by id when the paying body is already linked to a Morning client', async () => {
    const res = await resolveMorningClient({
      ...baseOrder,
      payingBodyRef: pb({ morningClientId: 'morning-uuid-123' }),
    });
    expect(res.client).toEqual({ id: 'morning-uuid-123' });
    expect(res.cacheTarget).toBeNull();
    expect(res.discoveredId).toBeNull();
  });

  it('sends full details with add:true and asks to cache the id onto the paying body when not yet in Morning', async () => {
    const res = await resolveMorningClient({
      ...baseOrder,
      payingBodyRef: pb(),
    });
    expect(res.client).toMatchObject({
      name: 'עיריית חולון',
      taxId: '500200300',
      emails: ['pay@holon.muni.il'],
      phone: '03-1234567',
      add: true,
    });
    expect(res.client.id).toBeUndefined();
    expect(res.cacheTarget).toEqual({ kind: 'payingBody', id: 'pb-1' });
    expect(res.discoveredId).toBeNull();
  });

  it('prefers the paying body name over the order free-text payer', async () => {
    const res = await resolveMorningClient({
      ...baseOrder,
      payingBody: 'עירית חולון (טקסט ישן)',
      payingBodyRef: pb(),
    });
    expect(res.client.name).toBe('עיריית חולון');
    expect(res.cacheTarget).toEqual({ kind: 'payingBody', id: 'pb-1' });
  });
});

describe('resolveMorningClient — legacy fallbacks (no linked PayingBody)', () => {
  it('uses the free-text payer name with add:true and does not cache it', async () => {
    const res = await resolveMorningClient({
      ...baseOrder,
      payingBody: 'מתנ"ס רמת אביב',
      taxId: '12345',
      contactEmail: 'a@b.co',
    });
    expect(res.client).toMatchObject({ name: 'מתנ"ס רמת אביב', taxId: '12345', emails: ['a@b.co'], add: true });
    expect(res.cacheTarget).toBeNull();
  });

  it('bills by the order-cached morning client id when present and no payer overrides it', async () => {
    const res = await resolveMorningClient({
      ...baseOrder,
      morningClientId: 'legacy-order-client',
    });
    expect(res.client).toEqual({ id: 'legacy-order-client' });
    expect(res.cacheTarget).toBeNull();
    expect(res.discoveredId).toBeNull();
  });
});
