import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {},
}));

vi.mock('../../services/instructor-reminder.service.js', () => ({
  previewDailyReminders: vi.fn(async () => ({
    date: '2026-08-25',
    instructorCount: 0,
    totalMeetings: 0,
    summaries: [],
  })),
  formatWhatsAppReminder: vi.fn(() => 'reminder'),
  getDailyMeetingsForInstructors: vi.fn(async () => []),
  verifyMeetingMagicLink: vi.fn(),
}));

vi.mock('../../services/notifications.js', () => ({
  sendWhatsAppMessage: vi.fn(),
}));

vi.mock('../../services/replacement-meeting.js', () => ({
  addReplacementMeetingWithRetry: vi.fn(),
}));

vi.mock('../../services/cycle-completion.js', () => ({
  handleCycleCompletion: vi.fn(),
}));

vi.mock('../../utils/revenue.js', () => ({
  meetingRevenueForMeeting: vi.fn(),
}));

vi.mock('../../utils/cycle-sync.js', () => ({
  syncCycleProgress: vi.fn(),
}));

vi.mock('../../services/instructor-payment.js', () => ({
  calculateInstructorPayment: vi.fn(),
  recalculateDailyInstructorPaymentsForMeeting: vi.fn(),
}));

vi.mock('../../services/negative-profit-alert.js', () => ({
  checkAndSendNegativeProfitAlert: vi.fn(),
}));

vi.mock('../../services/meeting-report-quality-alert.js', () => ({
  checkAndSendMeetingReportQualityAlert: vi.fn(),
}));

const currentRole = vi.hoisted(() => ({ value: 'operations_manager' }));

vi.mock('../../middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../middleware/auth.js')>('../../middleware/auth.js');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        userId: 'user-1',
        email: 'arielmeidar23@gmail.com',
        name: 'אריאל מידר',
        role: currentRole.value,
      };
      next();
    },
  };
});

import { instructorMagicRouter } from '../instructor-magic.js';

const app = express();
app.use(express.json());
app.use('/api/instructor-magic', instructorMagicRouter);

describe('instructor magic management permissions', () => {
  beforeEach(() => {
    currentRole.value = 'operations_manager';
  });

  it('allows operations managers to preview instructor reminders', async () => {
    const response = await request(app).get('/api/instructor-magic/preview-reminders');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      instructorCount: 0,
      totalMeetings: 0,
      reminders: [],
    });
  });

  it('allows operations managers through the send-test authorization layer', async () => {
    const response = await request(app).post('/api/instructor-magic/send-test/instructor-1');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'NO_MEETINGS' });
  });
});
