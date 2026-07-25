import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    waConversation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    waMessage: {
      create: vi.fn(),
    },
  },
}));

import axios from 'axios';
import { prisma } from '../../utils/prisma.js';
import {
  buildParentOnlineReminderTemplateVariables,
  buildParentReminderPreview,
  buildParentReminderTemplateVariables,
  sendParentWhatsAppReminder,
} from '../parent-whatsapp-reminders.js';

const reminderData = {
  parentName: 'שרית',
  studentName: 'ירדן',
  className: 'רובלוקס',
  date: 'יום ראשון, 19.7.2026',
  time: '15:00',
  location: 'אונליין',
  instructorName: 'נועה',
  isOnline: true,
  zoomLink: 'https://zoom.example/j/123',
};

describe('parent WhatsApp reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PARENT_REMINDER_WA_ENABLED;
    delete process.env.PARENT_REMINDER_WA_TEMPLATE_NAME;
    process.env.WA_PHONE_NUMBER_ID = '171389679383708';
    process.env.WA_ACCESS_TOKEN = 'token';
  });

  it('builds Meta template variables in the documented order', () => {
    expect(buildParentReminderTemplateVariables(reminderData)).toEqual([
      'שרית',
      'ירדן',
      'רובלוקס',
      'יום ראשון, 19.7.2026',
      '15:00',
      'אונליין',
      'נועה',
      'קישור לזום: https://zoom.example/j/123',
    ]);
  });

  it('builds online Meta template variables in the documented order', () => {
    expect(buildParentOnlineReminderTemplateVariables(reminderData)).toEqual([
      'שרית',
      'ירדן',
      'רובלוקס',
      '15:00',
      'https://zoom.example/j/123',
    ]);
  });

  it('never sends empty Meta text template variables', () => {
    expect(buildParentReminderTemplateVariables({
      parentName: '',
      studentName: '',
      className: '',
      date: '',
      time: '',
      location: '',
      instructorName: '',
      isOnline: false,
      zoomLink: '',
    })).toEqual([
      'שלום',
      'התלמיד/ה',
      'השיעור',
      'מחר',
      'השעה תעודכן בהמשך',
      'אונליין',
      'צוות HaiTech',
      'לשיעור פרונטלי, אין צורך בקישור זום',
    ]);
  });

  it('is disabled by default', async () => {
    const result = await sendParentWhatsAppReminder({
      phone: '0544431571',
      contactName: 'שרית',
      data: reminderData,
    });

    expect(result).toEqual({ sent: false, skipped: 'disabled' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('sends the approved parent reminder template and stores it in the inbox when enabled', async () => {
    process.env.PARENT_REMINDER_WA_ENABLED = 'true';
    process.env.PARENT_REMINDER_WA_TEMPLATE_NAME = 'parent_lesson_reminder';
    (axios.post as any).mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
    (prisma.waConversation.findFirst as any).mockResolvedValue({ id: 'conv-1', contactName: 'שרית', businessPhone: null, phoneNumberId: null });
    (prisma.waMessage.create as any).mockResolvedValue({ id: 'msg-1', waMessageId: 'wamid.1' });

    const result = await sendParentWhatsAppReminder({
      phone: '0544431571',
      contactName: 'שרית',
      data: reminderData,
    });

    expect(result).toEqual({ sent: true, messageId: 'wamid.1' });
    expect(axios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/171389679383708/messages',
      expect.objectContaining({
        to: '972544431571',
        type: 'template',
        template: expect.objectContaining({
          name: 'parent_lesson_reminder',
        }),
      }),
      expect.any(Object),
    );
    expect(prisma.waMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        direction: 'outbound',
        content: buildParentReminderPreview(reminderData, 'parent_lesson_reminder'),
        waMessageId: 'wamid.1',
        status: 'sent',
      }),
    });
  });
});
