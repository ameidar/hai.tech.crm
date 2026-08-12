import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../messaging.js', () => ({
  sendWhatsApp: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
}));

import { sendWhatsApp } from '../messaging.js';
import {
  getOperationsEmailRecipients,
  getOperationsWhatsAppRecipients,
  sendOperationsWhatsApp,
} from '../operations-notifications.js';

describe('operations notification recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPERATIONS_RECIPIENTS;
  });

  it('defaults WhatsApp operations alerts to Ami and Kim', () => {
    expect(getOperationsWhatsAppRecipients()).toEqual([
      { name: 'עמי', phone: '0528746137' },
      { name: 'קים', phone: '0543354550' },
    ]);
  });

  it('defaults operations emails to Ami and Kim', () => {
    expect(getOperationsEmailRecipients()).toEqual([
      'ami@hai.tech',
      'navekim@gmail.com',
    ]);
  });

  it('keeps default operations emails when legacy management emails are provided', () => {
    expect(getOperationsEmailRecipients('hila@hai.tech,ami@hai.tech')).toEqual([
      'hila@hai.tech',
      'ami@hai.tech',
      'navekim@gmail.com',
    ]);
  });

  it('sends operations WhatsApp messages to both default recipients', async () => {
    await sendOperationsWhatsApp('בדיקה');

    expect(sendWhatsApp).toHaveBeenCalledTimes(2);
    expect(sendWhatsApp).toHaveBeenCalledWith({ phone: '0528746137', message: 'בדיקה' });
    expect(sendWhatsApp).toHaveBeenCalledWith({ phone: '0543354550', message: 'בדיקה' });
  });

  it('supports configured recipients and removes duplicate phones', () => {
    process.env.OPERATIONS_RECIPIENTS = 'עמי|0528746137|ami@hai.tech,כפול|972528746137|other@example.com,קים|0543354550|navekim@gmail.com';

    expect(getOperationsWhatsAppRecipients()).toEqual([
      { name: 'כפול', phone: '972528746137' },
      { name: 'קים', phone: '0543354550' },
    ]);
  });

  it('derives configured email recipients from the same operations setting', () => {
    process.env.OPERATIONS_RECIPIENTS = 'עמי|0528746137|ami@hai.tech,קים|0543354550|kim@hai.tech';

    expect(getOperationsEmailRecipients()).toEqual([
      'ami@hai.tech',
      'kim@hai.tech',
    ]);
  });
});
