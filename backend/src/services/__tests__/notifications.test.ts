import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(),
    })),
  },
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    leadInternalAlertDelivery: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../green-api-client.js', () => ({
  sendGreenApiMessage: vi.fn(),
}));

import { prisma } from '../../utils/prisma.js';
import { sendGreenApiMessage } from '../green-api-client.js';
import { notifyAdminNewLead } from '../notifications.js';

const delivery = prisma.leadInternalAlertDelivery as any;
const sendGreen = vi.mocked(sendGreenApiMessage);

describe('notifyAdminNewLead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delivery.findUnique.mockResolvedValue(null);
    delivery.upsert.mockResolvedValue({});
    delivery.update.mockResolvedValue({});
    sendGreen.mockResolvedValue({ success: true, messageId: 'green-ok' });
  });

  it('sends internal lead alerts sequentially and records each destination', async () => {
    await notifyAdminNewLead({
      name: 'אהרון',
      phone: '0501234567',
      source: 'hero-form-roblox',
      leadAppointmentId: 'lead-1',
    });

    expect(sendGreen).toHaveBeenCalledTimes(2);
    expect(sendGreen.mock.calls[0][0]).toBe('972528746137@c.us');
    expect(sendGreen.mock.calls[1][0]).toBe('120363308669020817@g.us');
    expect(delivery.upsert).toHaveBeenCalledTimes(2);
    expect(delivery.update).toHaveBeenCalledTimes(2);
    expect(delivery.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ status: 'sent', attempts: 1, messageId: 'green-ok' }),
    }));
    expect(delivery.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: 'sent', attempts: 1, messageId: 'green-ok' }),
    }));
  });

  it('retries a failed destination and persists the final error', async () => {
    sendGreen
      .mockResolvedValueOnce({ success: true, messageId: 'admin-ok' })
      .mockResolvedValueOnce({ success: false, error: 'rate limit' })
      .mockResolvedValueOnce({ success: false, error: 'timeout' })
      .mockResolvedValueOnce({ success: false, error: 'still blocked' });

    await notifyAdminNewLead({
      name: 'סמיח',
      phone: '0507654321',
      source: 'hero-form-roblox',
      leadAppointmentId: 'lead-2',
    });

    expect(sendGreen).toHaveBeenCalledTimes(4);
    expect(delivery.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ status: 'sent', attempts: 1, messageId: 'admin-ok' }),
    }));
    expect(delivery.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        status: 'failed',
        attempts: 3,
        messageId: null,
        lastError: 'still blocked',
      }),
    }));
  });

  it('does not resend a destination that was already sent for the lead', async () => {
    delivery.findUnique
      .mockResolvedValueOnce({ id: 'delivery-admin', status: 'sent', attempts: 1 })
      .mockResolvedValueOnce(null);

    await notifyAdminNewLead({
      name: 'ליד חוזר',
      phone: '0501111111',
      source: 'hero-form-roblox',
      leadAppointmentId: 'lead-3',
    });

    expect(sendGreen).toHaveBeenCalledTimes(1);
    expect(sendGreen).toHaveBeenCalledWith(
      '120363308669020817@g.us',
      expect.stringContaining('ליד חוזר'),
    );
    expect(delivery.upsert).toHaveBeenCalledTimes(1);
    expect(delivery.update).toHaveBeenCalledTimes(1);
  });
});
