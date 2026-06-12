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

/** Fetch a single Morning client by id. */
export async function getMorningClient(id: string): Promise<MorningClientRecord> {
  return morningRequest<MorningClientRecord>('GET', `/api/v1/clients/${encodeURIComponent(id)}`);
}

/**
 * Update an existing Morning client. Morning's PUT replaces the whole record, so we fetch the
 * current client first and merge only the provided fields onto it — otherwise any field we omit
 * would be wiped. Pass only the fields you want to change.
 */
export async function updateMorningClient(
  id: string,
  changes: Partial<Pick<MorningClientRecord, 'name' | 'taxId' | 'emails' | 'phone' | 'address' | 'city' | 'zip'>>
): Promise<MorningClientRecord> {
  const current = await getMorningClient(id);
  const merged = { ...current, ...changes };
  // `id` is taken from the path, not the body.
  const { id: _omit, ...body } = merged as unknown as Record<string, unknown>;
  return morningRequest<MorningClientRecord>('PUT', `/api/v1/clients/${encodeURIComponent(id)}`, body);
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

/**
 * Create a new client in Morning. Returns the assigned UUID.
 *
 * Use this when we know there's no existing Morning client for a CRM customer
 * (we've already searched by taxId / email / phone with no hit) and we want
 * to link the customer to a real Morning client up-front rather than letting
 * Morning create one implicitly during document issuance.
 */
export async function createMorningClient(input: {
  name: string;
  taxId?: string;
  emails?: string[];
  phone?: string;
  address?: string;
  city?: string;
}): Promise<MorningClientRecord> {
  const body: any = { name: input.name };
  if (input.taxId) body.taxId = input.taxId;
  if (input.emails?.length) body.emails = input.emails;
  if (input.phone) body.phone = input.phone;
  if (input.address) body.address = input.address;
  if (input.city) body.city = input.city;
  return morningRequest<MorningClientRecord>('POST', '/api/v1/clients', body);
}

/**
 * Best-effort matcher for a personal CRM customer. Looks for the same person
 * already in Morning by taxId → email → phone → name. Returns null when no
 * confident match exists; callers should fall back to creating a new client.
 */
export async function findClientForCustomer(customer: {
  name?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<MorningClientRecord | null> {
  if (customer.taxId) {
    const r = await searchClients({ taxId: customer.taxId });
    const exact = r.filter(c => c.taxId === customer.taxId);
    if (exact.length === 1) return exact[0];
  }
  if (customer.email) {
    const local = customer.email.split('@')[0];
    if (local) {
      const r = await searchClients({ name: local });
      const exact = r.filter(c =>
        (c.emails || []).some(e => e.toLowerCase() === customer.email!.toLowerCase())
      );
      if (exact.length === 1) return exact[0];
    }
  }
  if (customer.phone) {
    const r = await searchClients({ name: customer.phone });
    const exact = r.filter(c => (c.phone || '').replace(/\D/g, '') === customer.phone!.replace(/\D/g, ''));
    if (exact.length === 1) return exact[0];
  }
  if (customer.name) {
    const r = await searchClients({ name: customer.name });
    const exact = r.filter(c => c.name === customer.name);
    if (exact.length === 1) return exact[0];
  }
  return null;
}
