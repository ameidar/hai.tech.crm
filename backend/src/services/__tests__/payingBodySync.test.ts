import { describe, it, expect } from 'vitest';
import { comparePayingBodyToMorning, planSync } from '../payingBodySync.js';
import type { MorningClientRecord } from '../morning/clients.js';

const pb = (over: Record<string, unknown> = {}) => ({
  name: 'עיריית חולון',
  taxId: '500200300',
  email: 'pay@holon.muni.il',
  phone: '03-1234567',
  address: 'ויצמן 58',
  city: 'חולון',
  zip: '5810201',
  ...over,
});

const client = (over: Partial<MorningClientRecord> = {}): MorningClientRecord => ({
  id: 'morning-1',
  name: 'עיריית חולון',
  taxId: '500200300',
  emails: ['pay@holon.muni.il'],
  phone: '03-1234567',
  address: 'ויצמן 58',
  city: 'חולון',
  zip: '5810201',
  ...over,
});

describe('comparePayingBodyToMorning', () => {
  it('marks every field equal when both sides match', () => {
    const diffs = comparePayingBodyToMorning(pb(), client());
    expect(diffs.every((d) => d.equal)).toBe(true);
    expect(diffs.every((d) => !d.locked)).toBe(true);
  });

  it('detects a differing field and maps email to the first Morning email', () => {
    const diffs = comparePayingBodyToMorning(pb({ email: 'new@holon.il' }), client({ emails: ['old@holon.il'] }));
    const email = diffs.find((d) => d.field === 'email')!;
    expect(email.equal).toBe(false);
    expect(email.crm).toBe('new@holon.il');
    expect(email.morning).toBe('old@holon.il');
  });

  it('treats empty string and null as the same (no false diff)', () => {
    const diffs = comparePayingBodyToMorning(pb({ zip: '' }), client({ zip: null }));
    expect(diffs.find((d) => d.field === 'zip')!.equal).toBe(true);
  });

  it('locks taxId only when both sides are set and different', () => {
    const conflict = comparePayingBodyToMorning(pb({ taxId: '111' }), client({ taxId: '222' }));
    expect(conflict.find((d) => d.field === 'taxId')!.locked).toBe(true);

    const fillable = comparePayingBodyToMorning(pb({ taxId: '' }), client({ taxId: '222' }));
    expect(fillable.find((d) => d.field === 'taxId')!.locked).toBe(false);
  });
});

describe('planSync', () => {
  it('copies a Morning value into the paying body (fromMorning)', () => {
    const plan = planSync(pb({ phone: '03-1' }), client({ phone: '03-9' }), { phone: 'fromMorning' });
    expect(plan.pbUpdates).toEqual({ phone: '03-9' });
    expect(plan.morningChanges).toEqual({});
    expect(plan.errors).toEqual([]);
  });

  it('pushes a CRM value to Morning and merges the email list (toMorning)', () => {
    const plan = planSync(
      pb({ email: 'new@x.il' }),
      client({ emails: ['old@x.il', 'cc@x.il'] }),
      { email: 'toMorning' }
    );
    expect(plan.morningChanges.emails).toEqual(['new@x.il', 'old@x.il', 'cc@x.il']);
    expect(plan.pbUpdates).toEqual({});
  });

  it('fills an empty taxId from Morning but never overwrites an existing one', () => {
    const fill = planSync(pb({ taxId: '' }), client({ taxId: '999' }), { taxId: 'fromMorning' });
    expect(fill.pbUpdates).toEqual({ taxId: '999' });
    expect(fill.errors).toEqual([]);

    const blocked = planSync(pb({ taxId: '111' }), client({ taxId: '999' }), { taxId: 'fromMorning' });
    expect(blocked.pbUpdates).toEqual({});
    expect(blocked.errors.length).toBe(1);
  });

  it('refuses to copy an empty source value', () => {
    const plan = planSync(pb({ city: 'חולון' }), client({ city: null }), { city: 'fromMorning' });
    expect(plan.pbUpdates).toEqual({});
    expect(plan.errors.length).toBe(1);
  });

  it('ignores fields that are already equal', () => {
    const plan = planSync(pb(), client(), { name: 'toMorning', phone: 'fromMorning' });
    expect(plan.pbUpdates).toEqual({});
    expect(plan.morningChanges).toEqual({});
    expect(plan.errors).toEqual([]);
  });
});
