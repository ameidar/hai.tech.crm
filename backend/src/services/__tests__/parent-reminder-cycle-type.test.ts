import { describe, expect, it } from 'vitest';
import {
  cycleTypeAllowsParentReminders,
  resolveSendParentReminders,
} from '../reminder-eligibility.js';

describe('parent reminders by cycle type', () => {
  it('never sends parent reminders for institutional cycles billed per meeting', () => {
    expect(cycleTypeAllowsParentReminders('institutional_fixed')).toBe(false);
    expect(resolveSendParentReminders('institutional_fixed', true)).toBe(false);
    expect(resolveSendParentReminders('institutional_fixed', undefined)).toBe(false);
  });

  it('keeps parent reminders for cycles with a paying parent', () => {
    for (const type of ['institutional_per_child', 'private', 'group', 'trial_private']) {
      expect(cycleTypeAllowsParentReminders(type)).toBe(true);
      expect(resolveSendParentReminders(type, undefined)).toBe(true);
      expect(resolveSendParentReminders(type, false)).toBe(false);
    }
  });
});
