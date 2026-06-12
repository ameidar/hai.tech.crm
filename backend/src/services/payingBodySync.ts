import type { MorningClientRecord } from './morning/clients.js';

// Fields synced between a PayingBody (CRM) and its linked Morning client. `contactName` is
// intentionally excluded — Morning has no matching field, it lives CRM-side only.
export const SYNC_FIELDS = ['name', 'taxId', 'email', 'phone', 'address', 'city', 'zip'] as const;
export type SyncField = (typeof SYNC_FIELDS)[number];

export interface PayingBodyShape {
  name?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
}

const norm = (v: unknown): string | null => {
  const s = (v ?? '').toString().trim();
  return s === '' ? null : s;
};

const pbValue = (pb: PayingBodyShape, field: SyncField): string | null =>
  norm((pb as unknown as Record<string, unknown>)[field]);

const morningValue = (client: MorningClientRecord, field: SyncField): string | null => {
  if (field === 'email') return norm(client.emails?.[0]);
  return norm((client as unknown as Record<string, unknown>)[field]);
};

export interface FieldDiff {
  field: SyncField;
  crm: string | null;
  morning: string | null;
  equal: boolean;
  /** taxId conflict: both sides set and different — copying is forbidden in either direction. */
  locked: boolean;
}

/** Field-by-field comparison between a paying body and its Morning client. */
export function comparePayingBodyToMorning(pb: PayingBodyShape, client: MorningClientRecord): FieldDiff[] {
  return SYNC_FIELDS.map((field) => {
    const crm = pbValue(pb, field);
    const morning = morningValue(client, field);
    const equal = crm === morning;
    const locked = field === 'taxId' && !equal && !!crm && !!morning;
    return { field, crm, morning, equal, locked };
  });
}

export type SyncDirection = 'fromMorning' | 'toMorning';
export type SyncDecisions = Partial<Record<SyncField, SyncDirection>>;

export interface SyncPlan {
  /** Field→value to write onto the PayingBody (CRM side). */
  pbUpdates: PayingBodyShape;
  /** Field→value to write onto the Morning client. `emails` already merged with existing. */
  morningChanges: Partial<Pick<MorningClientRecord, 'name' | 'taxId' | 'emails' | 'phone' | 'address' | 'city' | 'zip'>>;
  errors: string[];
}

const FIELD_LABEL: Record<SyncField, string> = {
  name: 'שם',
  taxId: 'ח.פ / ת.ז',
  email: 'מייל',
  phone: 'טלפון',
  address: 'כתובת',
  city: 'עיר',
  zip: 'מיקוד',
};

const mergeEmails = (existing: string[] | null | undefined, email: string): string[] => [
  email,
  ...(existing ?? []).filter((e) => e.trim().toLowerCase() !== email.toLowerCase()),
];

/**
 * Build the concrete updates for a set of per-field sync decisions, enforcing two rules:
 *  - We never copy an empty source value (nothing to sync, and it avoids blanking a field).
 *  - taxId is never overwritten: a copy is allowed only when the target side is empty (or already
 *    equal). A genuine conflict (both set, different) is rejected.
 */
export function planSync(pb: PayingBodyShape, client: MorningClientRecord, decisions: SyncDecisions): SyncPlan {
  const plan: SyncPlan = { pbUpdates: {}, morningChanges: {}, errors: [] };

  for (const field of SYNC_FIELDS) {
    const direction = decisions[field];
    if (!direction) continue;

    const crm = pbValue(pb, field);
    const morning = morningValue(client, field);
    if (crm === morning) continue; // already in sync, nothing to do

    const source = direction === 'fromMorning' ? morning : crm;
    const target = direction === 'fromMorning' ? crm : morning;

    if (source === null) {
      plan.errors.push(`${FIELD_LABEL[field]}: אין ערך להעתקה בכיוון שנבחר`);
      continue;
    }
    if (field === 'taxId' && target !== null) {
      plan.errors.push(`${FIELD_LABEL[field]}: לא ניתן לדרוס ח.פ/ת.ז קיים — מותר רק למלא צד ריק`);
      continue;
    }

    if (direction === 'fromMorning') {
      (plan.pbUpdates as Record<string, unknown>)[field] = source;
    } else if (field === 'email') {
      plan.morningChanges.emails = mergeEmails(client.emails, source);
    } else {
      (plan.morningChanges as Record<string, unknown>)[field] = source;
    }
  }

  return plan;
}
