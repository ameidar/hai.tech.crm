import { describe, expect, it } from 'vitest';
import { __operationsControlTestUtils } from '../operations-control.service.js';

const detectedAt = '2026-07-21T12:00:00.000Z';

function meeting(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id || 'meeting-1',
    scheduledDate: new Date(`${overrides.date || '2026-07-21'}T00:00:00Z`),
    startTime: new Date(`1970-01-01T${overrides.startTime || '08:00'}:00Z`),
    endTime: new Date(`1970-01-01T${overrides.endTime || '09:00'}:00Z`),
    status: overrides.status || 'scheduled',
    topic: overrides.topic ?? null,
    profit: overrides.profit ?? 500,
    cycle: {
      id: overrides.cycleId || 'cycle-1',
      name: overrides.cycleName || 'מחזור בדיקה',
      branch: { name: overrides.branchName || 'סניף בדיקה' },
      course: { name: 'קורס בדיקה' },
      registrations: overrides.registrations ?? [{ id: 'registration-1', status: 'active' }],
    },
    instructor: { id: 'instructor-1', name: overrides.instructorName || 'קים' },
    attendance: overrides.attendance ?? [],
  } as any;
}

function task(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id || 'task-1',
    title: overrides.title || 'משימת בדיקה',
    dueDate: overrides.dueDate || new Date('2026-07-20T08:00:00Z'),
    priority: overrides.priority || 'normal',
    assignee: overrides.assignee ?? { id: 'user-1', name: 'קים', role: 'operations' },
  } as any;
}

describe('operations control alert rules', () => {
  it('creates an urgent alert for a scheduled meeting that ended more than two hours ago today', () => {
    const alerts = __operationsControlTestUtils.buildPastScheduledAlerts(
      [meeting({ endTime: '09:00' })],
      { today: '2026-07-21', nowMinutes: 12 * 60, detectedAt },
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      priority: 'urgent',
      type: 'past_scheduled_meeting',
      entityUrl: '/meetings/meeting-1',
    });
  });

  it('creates a missing topic alert for a completed meeting without a topic', () => {
    const alerts = __operationsControlTestUtils.buildMissingTopicAlerts(
      [meeting({ status: 'completed', topic: '   ' })],
      detectedAt,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('missing_topic');
  });

  it('creates a missing attendance alert only when registered students exist and no attendance was marked', () => {
    const alerts = __operationsControlTestUtils.buildMissingAttendanceAlerts(
      [
        meeting({ id: 'missing', status: 'completed', attendance: [] }),
        meeting({ id: 'marked', status: 'completed', attendance: [{ id: 'attendance-1' }] }),
        meeting({ id: 'empty-cycle', status: 'completed', registrations: [], attendance: [] }),
      ],
      detectedAt,
    );

    expect(alerts.map((alert) => alert.entityId)).toEqual(['missing']);
  });

  it('maps overdue urgent or high tasks to urgent alerts', () => {
    const alerts = __operationsControlTestUtils.buildOverdueTaskAlerts(
      [task({ priority: 'high' }), task({ id: 'task-2', priority: 'normal' })],
      detectedAt,
    );

    expect(alerts[0]).toMatchObject({ priority: 'urgent', type: 'overdue_task', taskId: 'task-1' });
    expect(alerts[1]).toMatchObject({ priority: 'high', type: 'overdue_task', taskId: 'task-2' });
  });

  it('creates urgent low-profit alerts for negative completed meetings', () => {
    const alerts = __operationsControlTestUtils.buildLowProfitAlerts(
      [meeting({ status: 'completed', profit: -25 })],
      detectedAt,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ priority: 'urgent', type: 'low_profit' });
  });
});
