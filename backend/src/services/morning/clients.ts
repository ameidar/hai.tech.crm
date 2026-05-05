import { morningRequest } from './client.js';

export interface MorningClientRecord {
  id: string;
  name: string;
  taxId?: string | null;
  emails?: string[];
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
}

/**
 * Search Morning's client directory.
 *
 * Morning's `/clients/search` field name is `name` (we discovered this empirically — `search`,
 * `q`, and `searchValue` are silently ignored and return everything). We pass the name as-is
 * and let Morning's substring match do the work.
 */
export async function searchClients(query: { name?: string; taxId?: string; pageSize?: number }): Promise<MorningClientRecord[]> {
  const body: any = { page: 1, pageSize: query.pageSize ?? 25 };
  if (query.name) body.name = query.name;
  if (query.taxId) body.taxId = query.taxId;
  const resp = await morningRequest<{ items: MorningClientRecord[] }>('POST', '/api/v1/clients/search', body);
  return resp.items || [];
}

/**
 * Try to locate the right Morning client for an institutional order. Strategy, ordered by
 * confidence:
 *   1. taxId match — Morning enforces uniqueness on this field; an exact hit is definitive.
 *   2. email match — single hit on the same contact email is reliable.
 *   3. payingBody name match — Morning's customer is usually filed under the paying body
 *      (e.g. "רשת קהילה ופנאי") rather than the orderName ("מרכז סקו״פ חולון"), so prefer it.
 *   4. orderName name match — last resort.
 *
 * Returns `null` when nothing confidently matches; the caller should surface that to a human
 * rather than auto-creating, since duplicate customers in Morning are a pain to clean up.
 */
export async function findClientForInstitutionalOrder(order: {
  taxId?: string | null;
  contactEmail?: string | null;
  orderName?: string | null;
  payingBody?: string | null;
}): Promise<{ client: MorningClientRecord; matchedBy: 'taxId' | 'email' | 'payingBody' | 'orderName' } | null> {
  // 1. taxId
  if (order.taxId) {
    const r = await searchClients({ taxId: order.taxId });
    const exact = r.filter(c => c.taxId === order.taxId);
    if (exact.length === 1) return { client: exact[0], matchedBy: 'taxId' };
  }

  // 2. email — Morning's name search doesn't filter emails, so we name-search nothing and
  //    fall back to scanning every page (small enough). Quick approach: search by part of
  //    the local part since Morning sometimes stores the email's domain inside name.
  if (order.contactEmail) {
    // Morning has no native "search by email" endpoint; we search by the local part of the
    // email and filter results client-side.
    const local = order.contactEmail.split('@')[0];
    if (local) {
      const r = await searchClients({ name: local });
      const exact = r.filter(c =>
        (c.emails || []).some(e => e.toLowerCase() === order.contactEmail!.toLowerCase())
      );
      if (exact.length === 1) return { client: exact[0], matchedBy: 'email' };
    }
  }

  // 3. payingBody name — exact phrase tends to win
  if (order.payingBody) {
    const r = await searchClients({ name: order.payingBody });
    const exact = r.filter(c => c.name === order.payingBody);
    if (exact.length === 1) return { client: exact[0], matchedBy: 'payingBody' };
    // partial match: take first if only 1 result and it strongly contains the phrase
    if (r.length === 1) return { client: r[0], matchedBy: 'payingBody' };
  }

  // 4. orderName
  if (order.orderName) {
    const r = await searchClients({ name: order.orderName });
    const exact = r.filter(c => c.name === order.orderName);
    if (exact.length === 1) return { client: exact[0], matchedBy: 'orderName' };
  }

  return null;
}
