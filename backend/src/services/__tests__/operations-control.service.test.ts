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

function lead(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id || 'lead-1',
    customerId: overrides.customerId || 'customer-1',
    customerName: overrides.customerName || 'אנה',
    customerPhone: overrides.customerPhone || '972507227282',
    customerEmail: overrides.customerEmail || 'annabad@assuta.co.il',
    appointmentStatus: overrides.appointmentStatus || 'pending',
    salesStatus: overrides.salesStatus || 'interested',
    nextFollowUpAt: overrides.nextFollowUpAt ?? new Date('2026-07-22T08:00:00Z'),
    assignedTo: overrides.assignedTo ?? { id: 'user-1', name: 'קים נוה', role: 'operations_control' },
    customer: overrides.customer ?? { id: 'customer-1', name: 'אנה' },
    activities: overrides.activities ?? [
      {
        type: 'manual_email_required',
        result: 'manual_email_required',
        note: 'נדרשת תשובה ידנית',
        nextFollowUpAt: new Date('2026-07-21T12:00:00Z'),
        createdAt: new Date('2026-07-21T12:00:00Z'),
      },
    ],
  } as any;
}

function absence(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id || 'absence-1',
    status: 'absent',
    recordedAt: overrides.recordedAt || new Date('2026-07-21T10:00:00Z'),
    meeting: meeting({
      id: overrides.meetingId || 'meeting-absence-1',
      date: overrides.date || '2026-07-21',
      cycleId: overrides.cycleId || 'cycle-1',
      cycleName: overrides.cycleName || 'מחזור בדיקה',
    }),
    registration: {
      id: overrides.registrationId || 'registration-1',
      cycleId: overrides.cycleId || 'cycle-1',
      student: {
        id: overrides.studentId || 'student-1',
        name: overrides.studentName || 'עומר',
        customer: { id: overrides.customerId || 'customer-1', name: overrides.customerName || 'משפחת עומר' },
      },
      cycle: {
        id: overrides.cycleId || 'cycle-1',
        name: overrides.cycleName || 'מחזור בדיקה',
        branch: { name: overrides.branchName || 'סניף בדיקה' },
        course: { name: 'קורס בדיקה' },
        instructor: { id: 'instructor-1', name: overrides.instructorName || 'קים' },
      },
    },
  } as any;
}

function changeRequest(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id || 'change-1',
    instructorId: overrides.instructorId || 'instructor-1',
    type: overrides.type || 'postpone',
    status: overrides.status || 'pending',
    createdAt: overrides.createdAt || new Date('2026-07-21T10:00:00Z'),
    instructor: { id: overrides.instructorId || 'instructor-1', name: overrides.instructorName || 'קים' },
    meeting: meeting({
      id: overrides.meetingId || 'meeting-change-1',
      cycleName: overrides.cycleName || 'מחזור בדיקה',
    }),
  } as any;
}

function cycle(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id || 'cycle-1',
    name: overrides.name || 'מחזור בדיקה',
    studentCount: overrides.studentCount ?? 10,
    maxStudents: overrides.maxStudents ?? null,
    minimumStudentsThreshold: overrides.minimumStudentsThreshold ?? null,
    branch: { name: overrides.branchName || 'סניף בדיקה' },
    course: { name: 'קורס בדיקה' },
    instructor: { id: 'instructor-1', name: overrides.instructorName || 'קים' },
    registrations: overrides.registrations ?? [
      { id: 'reg-1', status: 'active', deletedAt: null, cancellationDate: null, student: { name: 'תלמיד פעיל' } },
      { id: 'reg-2', status: 'cancelled', deletedAt: null, cancellationDate: new Date('2026-07-10T00:00:00Z'), student: { name: 'תלמיד מבוטל 1' } },
      { id: 'reg-3', status: 'cancelled', deletedAt: null, cancellationDate: new Date('2026-07-12T00:00:00Z'), student: { name: 'תלמיד מבוטל 2' } },
    ],
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

  it('creates a high alert for a lead that requires a manual email response', () => {
    const alerts = __operationsControlTestUtils.buildLeadFollowUpAlerts(
      [lead()],
      { detectedAt, now: new Date('2026-07-21T12:00:00Z') },
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      priority: 'high',
      type: 'lead_follow_up',
      entityType: 'lead',
      entityUrl: '/lead-appointments?id=lead-1',
      contactUrl: '/customers/customer-1',
    });
  });

  it('does not alert future follow-up leads unless a manual response is required', () => {
    const alerts = __operationsControlTestUtils.buildLeadFollowUpAlerts(
      [lead({ activities: [] })],
      { detectedAt, now: new Date('2026-07-21T12:00:00Z') },
    );

    expect(alerts).toHaveLength(0);
  });

  it('creates urgent low-profit alerts for negative completed meetings', () => {
    const alerts = __operationsControlTestUtils.buildLowProfitAlerts(
      [meeting({ status: 'completed', profit: -25 })],
      detectedAt,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ priority: 'urgent', type: 'low_profit' });
  });

  it('creates a churn-risk alert for repeated student absences', () => {
    const alerts = __operationsControlTestUtils.buildStudentAbsenceRiskAlerts(
      [
        absence({ id: 'absence-1', meetingId: 'meeting-1', date: '2026-07-14' }),
        absence({ id: 'absence-2', meetingId: 'meeting-2', date: '2026-07-21' }),
      ],
      detectedAt,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      priority: 'high',
      type: 'student_absence_risk',
      entityType: 'cycle',
      contactUrl: '/customers/customer-1',
    });
  });

  it('creates an instructor-risk alert for repeated change requests', () => {
    const alerts = __operationsControlTestUtils.buildInstructorChangeRiskAlerts(
      [
        changeRequest({ id: 'change-1', type: 'cancel' }),
        changeRequest({ id: 'change-2', type: 'postpone', meetingId: 'meeting-change-2' }),
      ],
      detectedAt,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      priority: 'urgent',
      type: 'instructor_change_risk',
      entityType: 'instructor',
    });
  });

  it('creates a cycle churn alert for recent registration cancellations', () => {
    const alerts = __operationsControlTestUtils.buildCycleChurnRiskAlerts(
      [cycle()],
      { detectedAt, sinceDate: new Date('2026-06-01T00:00:00Z') },
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: 'cycle_churn_risk',
      entityUrl: '/cycles/cycle-1',
    });
  });

  it('creates a low-enrollment alert when active registrations drop below configured threshold', () => {
    const alerts = __operationsControlTestUtils.buildLowEnrollmentAlerts(
      [cycle({ minimumStudentsThreshold: 4 })],
      detectedAt,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: 'low_enrollment',
      priority: 'high',
      entityUrl: '/cycles/cycle-1',
    });
  });

  it('applies saved issue statuses and hides closed alerts', () => {
    const alerts = [
      {
        id: 'visible-alert',
        priority: 'high',
        type: 'missing_topic',
        title: 'פתוח',
        entityType: 'meeting',
        entityId: 'meeting-1',
        entityUrl: '/meetings/meeting-1',
        clientName: null,
        cycleName: null,
        instructorName: null,
        description: 'בדיקה',
        recommendedAction: 'לטפל',
        detectedAt,
        taskId: null,
      },
      {
        id: 'closed-alert',
        priority: 'high',
        type: 'missing_topic',
        title: 'סגור',
        entityType: 'meeting',
        entityId: 'meeting-2',
        entityUrl: '/meetings/meeting-2',
        clientName: null,
        cycleName: null,
        instructorName: null,
        description: 'בדיקה',
        recommendedAction: 'לטפל',
        detectedAt,
        taskId: null,
      },
    ] as any;

    const applied = __operationsControlTestUtils.applyIssueStates(alerts, [
      { issueKey: 'visible-alert', status: 'in_progress', note: null, updatedAt: new Date(detectedAt) },
      { issueKey: 'closed-alert', status: 'closed', note: null, updatedAt: new Date(detectedAt) },
    ]);

    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ id: 'visible-alert', status: 'in_progress' });
  });
});
