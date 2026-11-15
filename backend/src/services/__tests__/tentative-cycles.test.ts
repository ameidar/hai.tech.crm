import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit coverage for tentative cycles: transition rules, forecast tentativeRevenue from
// tentative meetings (and no double count with draft orders), monthly-fixed split, and the
// scheduler / report queries that must never pick up tentative meetings.

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    meeting: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { prisma } from '../../utils/prisma.js';
import {
  assertTentativeTransition,
  hasPlaceholderTime,
  isTentativeMeetingStatusChangeBlocked,
  tentativePlaceholderEnd,
} from '../tentative-cycles.js';
import {
  computeTentativeMeetingRevenue,
  computeTentativeRevenue,
  isTentativeOrder,
  tentativeMeetingRevenue,
  type TentativeMeetingInput,
} from '../forecast-tentative.js';
import { splitMonthlyRevenue } from '../monthly-fixed-billing.js';
import { reminderEligibleMeetingWhereForDate } from '../reminder-eligibility.js';
import { buildTomorrowMeetingCheckReport } from '../meeting-check-report.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('tentative transitions', () => {
  it('allows tentative → active / cancelled only', () => {
    expect(() => assertTentativeTransition('tentative', 'active')).not.toThrow();
    expect(() => assertTentativeTransition('tentative', 'cancelled')).not.toThrow();
    expect(() => assertTentativeTransition('tentative', undefined)).not.toThrow();
    expect(() => assertTentativeTransition('tentative', 'completed')).toThrow();
    expect(() => assertTentativeTransition('tentative', 'frozen')).toThrow();
    expect(() => assertTentativeTransition('tentative', 'retainer')).toThrow();
  });

  it('never turns an existing cycle tentative', () => {
    expect(() => assertTentativeTransition('active', 'tentative')).toThrow();
    expect(() => assertTentativeTransition('completed', 'tentative')).toThrow();
    expect(() => assertTentativeTransition('active', 'completed')).not.toThrow();
  });

  it('keeps tentative meetings from being marked scheduled/completed/postponed (cancel is ok)', () => {
    expect(isTentativeMeetingStatusChangeBlocked('tentative', 'tentative', 'completed')).toBe(true);
    expect(isTentativeMeetingStatusChangeBlocked('tentative', 'tentative', 'scheduled')).toBe(true);
    expect(isTentativeMeetingStatusChangeBlocked('cancelled', 'tentative', 'scheduled')).toBe(true);
    expect(isTentativeMeetingStatusChangeBlocked('tentative', 'tentative', 'cancelled')).toBe(false);
    expect(isTentativeMeetingStatusChangeBlocked('tentative', 'tentative', undefined)).toBe(false);
    expect(isTentativeMeetingStatusChangeBlocked('scheduled', 'active', 'completed')).toBe(false);
    // A meeting edit can never make a meeting tentative.
    expect(isTentativeMeetingStatusChangeBlocked('scheduled', 'active', 'tentative')).toBe(true);
    expect(isTentativeMeetingStatusChangeBlocked('tentative', 'tentative', 'tentative')).toBe(false);
  });

  it('placeholder time helpers', () => {
    expect(tentativePlaceholderEnd(60)).toBe('01:00');
    expect(tentativePlaceholderEnd(90)).toBe('01:30');
    expect(hasPlaceholderTime(new Date('1970-01-01T00:00:00.000Z'))).toBe(true);
    expect(hasPlaceholderTime(new Date('1970-01-01T16:00:00.000Z'))).toBe(false);
  });
});

describe('forecast — tentative meetings', () => {
  const meeting = (over: Partial<TentativeMeetingInput> & { date: string }): TentativeMeetingInput => ({
    id: over.id ?? Math.random().toString(36),
    cycleId: over.cycleId ?? 'c1',
    scheduledDate: d(over.date),
    revenue: over.revenue ?? 0,
    nature: over.nature ?? 'regular',
    cycle: over.cycle ?? { name: 'מחזור טנטטיבי', type: 'institutional_fixed', meetingRevenue: 500, branch: { name: 'סניף' } },
  });

  it('spreads each meeting revenue into its own month and ignores months outside the window', () => {
    const res = computeTentativeMeetingRevenue(
      [
        meeting({ date: '2026-12-06', revenue: 500 }),
        meeting({ date: '2026-12-13', revenue: 500 }),
        meeting({ date: '2027-01-03', revenue: 500 }),
        meeting({ date: '2027-06-01', revenue: 500 }), // outside window
      ],
      ['2026-12', '2027-01', '2027-02'],
    );
    expect(res.byMonth).toEqual({ '2026-12': 1000, '2027-01': 500, '2027-02': 0 });
    expect(res.total).toBe(1500);
    expect(res.cycles).toEqual([
      expect.objectContaining({ id: 'c1', total: 1500, meetingCount: 3, monthsCovered: ['2026-12', '2027-01'] }),
    ]);
  });

  it('falls back to cycle pricing, never to a historical guess', () => {
    expect(tentativeMeetingRevenue(meeting({ date: '2026-12-06', revenue: 0 }))).toBe(500);
    expect(tentativeMeetingRevenue(meeting({
      date: '2026-12-06',
      cycle: { name: 'x', type: 'institutional_per_child', pricePerStudent: 40, studentCount: 10 },
    }))).toBe(400);
    expect(tentativeMeetingRevenue(meeting({ date: '2026-12-06', cycle: { name: 'x', type: 'private' } }))).toBe(0);
    expect(tentativeMeetingRevenue(meeting({ date: '2026-12-06', revenue: 500, nature: 'no_revenue' }))).toBe(0);
  });

  it('a draft order with a tentative cycle counts via the cycle meetings, not its own amounts', () => {
    const draftWithTentativeCycle = {
      id: 'o1',
      status: 'draft',
      totalAmount: 9000,
      startDate: d('2026-12-01'),
      endDate: d('2027-02-28'),
      cycles: [{ status: 'tentative', deletedAt: null }],
    };
    expect(isTentativeOrder(draftWithTentativeCycle)).toBe(false);
    const orders = computeTentativeRevenue([draftWithTentativeCycle], ['2026-12', '2027-01', '2027-02']);
    expect(orders.total).toBe(0);
  });
});

describe('monthly-fixed split with tentative meetings', () => {
  it('tentative meetings never dilute confirmed meetings of the same month', () => {
    const split = splitMonthlyRevenue(
      [
        { id: 'a', scheduledDate: d('2026-12-06'), status: 'scheduled' },
        { id: 'b', scheduledDate: d('2026-12-13'), status: 'scheduled' },
        { id: 't', scheduledDate: d('2026-12-20'), status: 'tentative' },
      ],
      { '2026-12': 1000 },
    );
    expect(split.get('a')).toBe(500);
    expect(split.get('b')).toBe(500);
    expect(split.get('t')).toBe(0);
  });

  it('a month with only tentative meetings splits its amount across them (forecast only)', () => {
    const split = splitMonthlyRevenue(
      [
        { id: 't1', scheduledDate: d('2027-01-03'), status: 'tentative' },
        { id: 't2', scheduledDate: d('2027-01-10'), status: 'tentative' },
      ],
      { '2027-01': 800 },
    );
    expect(split.get('t1')).toBe(400);
    expect(split.get('t2')).toBe(400);
  });
});

describe('schedulers / reports exclude tentative meetings', () => {
  beforeEach(() => vi.mocked(prisma.meeting.findMany).mockClear());

  it('all reminder jobs (instructor daily schedule, 60m pre-lesson, unresolved alert, status check, parent reminders) select scheduled meetings of active cycles only', () => {
    const where = reminderEligibleMeetingWhereForDate(d('2026-12-06')) as any;
    expect(where.status).toBe('scheduled');
    expect(where.cycle.status).toBe('active');
  });

  it('nightly meeting-check report query excludes tentative meetings', async () => {
    await buildTomorrowMeetingCheckReport();
    const args = vi.mocked(prisma.meeting.findMany).mock.calls[0][0] as any;
    expect(args.where.status).toEqual({ not: 'tentative' });
  });
});
