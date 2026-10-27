import { describe, expect, it } from 'vitest';
import { defaultSendParentReminders, resolveSendParentReminders } from '../reminder-eligibility.js';

describe('parent reminders default by cycle type', () => {
  it('defaults OFF for institutional cycles billed per meeting, but allows opting in', () => {
    expect(defaultSendParentReminders('institutional_fixed')).toBe(false);
    expect(resolveSendParentReminders('institutional_fixed', undefined)).toBe(false);
    expect(resolveSendParentReminders('institutional_fixed', true)).toBe(true);
  });

  it('defaults ON for cycles with a paying parent', () => {
    for (const type of ['institutional_per_child', 'private', 'group', 'trial_private']) {
      expect(resolveSendParentReminders(type, undefined)).toBe(true);
      expect(resolveSendParentReminders(type, false)).toBe(false);
    }
  });
});
