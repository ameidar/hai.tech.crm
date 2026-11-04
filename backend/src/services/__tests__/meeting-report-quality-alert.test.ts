import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    meeting: {
      findUnique: vi.fn(),
    },
    waMessage: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../whatsapp-cloud-templates.js', () => ({
  sendWhatsAppCloudTemplate: vi.fn().mockResolvedValue({ success: true, messageId: 'wa-1' }),
}));

vi.mock('../instructor-reminder.service.js', () => ({
  generateMeetingMagicLink: vi.fn(() => 'https://crm.orma-ai.com/i/meeting-1/tok'),
}));

vi.mock('../operations-notifications.js', () => ({
  sendOperationsWhatsApp: vi.fn().mockResolvedValue([
    { success: true, messageId: 'msg-1' },
    { success: true, messageId: 'msg-2' },
  ]),
}));

import { prisma } from '../../utils/prisma.js';
import { sendOperationsWhatsApp } from '../operations-notifications.js';
import { sendWhatsAppCloudTemplate } from '../whatsapp-cloud-templates.js';
import { checkAndSendMeetingReportQualityAlert, buildInstructorReportNudgeText, isTeachingAssistantCycle } from '../meeting-report-quality-alert.js';

function completedMeeting(overrides: Record<string, any> = {}) {
  return {
    id: 'meeting-1',
    status: 'completed',
    scheduledDate: new Date('2026-08-12T00:00:00Z'),
    startTime: new Date('1970-01-01T10:30:00Z'),
    topic: 'למדנו לולאות',
    instructor: { id: 'inst-1', name: 'נועה כהן', phone: '0501234567' },
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
    (prisma.waMessage.findFirst as any).mockResolvedValue(null);
  });

  it('alerts when a completed instructor report has no topic', async () => {
    (prisma.meeting.findUnique as any).mockResolvedValue(completedMeeting({ topic: '   ' }));

    await checkAndSendMeetingReportQualityAlert('meeting-1', 'test');

    expect(sendOperationsWhatsApp).toHaveBeenCalledTimes(1);
    expect(sendOperationsWhatsApp).toHaveBeenCalledWith(expect.stringContaining('לא כתב מה היה בשיעור'));
  });

  it('skips teaching-assistant cycles entirely (no ops alert, no instructor nudge)', async () => {
    (prisma.meeting.findUnique as any).mockResolvedValue(completedMeeting({
      topic: '',
      attendance: [],
      cycle: { ...completedMeeting().cycle, name: 'סקופ חולון ימי שלישי קבוצה 1 - תומכת הוראה' },
    }));

    await checkAndSendMeetingReportQualityAlert('meeting-1', 'test');

    expect(sendOperationsWhatsApp).not.toHaveBeenCalled();
    expect(sendWhatsAppCloudTemplate).not.toHaveBeenCalled();
  });

  it('recognizes teaching-assistant cycle names', () => {
    expect(isTeachingAssistantCycle('סקופ חולון ימי חמישי קבוצה 2 - תומכת הוראה')).toBe(true);
    expect(isTeachingAssistantCycle('מיינקראפט ו-AI - ב׳ קבוצה 2 תומכים - סקו״פ חולון')).toBe(true);
    expect(isTeachingAssistantCycle('אורט - סייבר - 14:30 - קבוצה 2')).toBe(false);
    expect(isTeachingAssistantCycle(null)).toBe(false);
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

  describe('instructor nudge', () => {
    it('sends the instructor one template message with the magic link when the topic is missing', async () => {
      (prisma.meeting.findUnique as any).mockResolvedValue(completedMeeting({ topic: '' }));

      await checkAndSendMeetingReportQualityAlert('meeting-1', 'instructor-magic');

      expect(sendWhatsAppCloudTemplate).toHaveBeenCalledTimes(1);
      const payload = (sendWhatsAppCloudTemplate as any).mock.calls[0][0];
      expect(payload.phone).toBe('0501234567');
      expect(payload.templateName).toBe('instructor_report_missing');
      expect(payload.bodyParameters).toEqual([
        'נועה',
        'רובלוקס קבוצה',
        expect.stringContaining('10:30'),
        'מה היה בשיעור',
        'https://crm.orma-ai.com/i/meeting-1/tok',
      ]);
      expect(payload.preview).toContain('[report-nudge:meeting-1]');
      expect(payload.preview).toContain('היי נועה');
    });

    it('does not nudge twice for the same meeting', async () => {
      (prisma.meeting.findUnique as any).mockResolvedValue(completedMeeting({ topic: '' }));
      (prisma.waMessage.findFirst as any).mockResolvedValue({ id: 'prev' });

      await checkAndSendMeetingReportQualityAlert('meeting-1', 'instructor-magic');

      expect(sendOperationsWhatsApp).toHaveBeenCalledTimes(1);
      expect(sendWhatsAppCloudTemplate).not.toHaveBeenCalled();
    });

    it('does not nudge when the report is complete', async () => {
      (prisma.meeting.findUnique as any).mockResolvedValue(completedMeeting());

      await checkAndSendMeetingReportQualityAlert('meeting-1', 'instructor-magic');

      expect(sendWhatsAppCloudTemplate).not.toHaveBeenCalled();
    });

    it('skips instructors without a phone', async () => {
      (prisma.meeting.findUnique as any).mockResolvedValue(
        completedMeeting({ topic: '', instructor: { id: 'inst-1', name: 'נועה', phone: null } }),
      );

      await checkAndSendMeetingReportQualityAlert('meeting-1', 'instructor-magic');

      expect(sendWhatsAppCloudTemplate).not.toHaveBeenCalled();
    });

    it('nudge text lists both missing parts', () => {
      const text = buildInstructorReportNudgeText(
        completedMeeting() as any,
        { missingTopic: true, missingAttendance: true },
        'LINK',
      );
      expect(text).toContain('מה היה בשיעור ונוכחות');
      expect(text).toContain('10:30');
      expect(text).toContain('LINK');
    });
  });
});
