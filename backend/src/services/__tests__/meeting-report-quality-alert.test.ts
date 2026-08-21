import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    meeting: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../operations-notifications.js', () => ({
  sendOperationsWhatsApp: vi.fn().mockResolvedValue([
    { success: true, messageId: 'msg-1' },
    { success: true, messageId: 'msg-2' },
  ]),
}));

import { prisma } from '../../utils/prisma.js';
import { sendOperationsWhatsApp } from '../operations-notifications.js';
import { checkAndSendMeetingReportQualityAlert } from '../meeting-report-quality-alert.js';

function completedMeeting(overrides: Record<string, any> = {}) {
  return {
    id: 'meeting-1',
    status: 'completed',
    scheduledDate: new Date('2026-08-12T00:00:00Z'),
    startTime: new Date('1970-01-01T10:30:00Z'),
    topic: 'למדנו לולאות',
    instructor: { name: 'נועה' },
    attendance: [{ id: 'att-1' }],
    cycle: {
      name: 'רובלוקס קבוצה',
      course: { name: 'רובלוקס' },
      branch: { name: 'חולון' },
      registrations: [{ id: 'reg-1' }, { id: 'reg-2' }],
    },
    ...overrides,
  };
}

describe('checkAndSendMeetingReportQualityAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('alerts when a completed instructor report has no topic', async () => {
    (prisma.meeting.findUnique as any).mockResolvedValue(completedMeeting({ topic: '   ' }));

    await checkAndSendMeetingReportQualityAlert('meeting-1', 'test');

    expect(sendOperationsWhatsApp).toHaveBeenCalledTimes(1);
    expect(sendOperationsWhatsApp).toHaveBeenCalledWith(expect.stringContaining('לא כתב מה היה בשיעור'));
  });

  it('alerts when a completed group meeting has no attendance', async () => {
    (prisma.meeting.findUnique as any).mockResolvedValue(completedMeeting({ attendance: [] }));

    await checkAndSendMeetingReportQualityAlert('meeting-1', 'test');

    expect(sendOperationsWhatsApp).toHaveBeenCalledTimes(1);
    expect(sendOperationsWhatsApp).toHaveBeenCalledWith(expect.stringContaining('לא מילא נוכחות לקבוצה'));
  });

  it('does not require attendance for a one-student meeting', async () => {
    (prisma.meeting.findUnique as any).mockResolvedValue(completedMeeting({
      attendance: [],
      cycle: {
        name: 'שיעור פרטי',
        course: { name: 'פייתון' },
        branch: { name: 'אונליין' },
        registrations: [{ id: 'reg-1' }],
      },
    }));

    await checkAndSendMeetingReportQualityAlert('meeting-1', 'test');

    expect(sendOperationsWhatsApp).not.toHaveBeenCalled();
  });
});
