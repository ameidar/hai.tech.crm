import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMailMock = vi.fn();

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: sendMailMock,
    })),
  },
}));

function stubRequiredEnv() {
  vi.stubEnv('JWT_SECRET', 'test-jwt-secret');
  vi.stubEnv('JWT_REFRESH_SECRET', 'test-refresh-secret');
  vi.stubEnv('API_KEY', 'test-api-key');
  vi.stubEnv('GMAIL_USER', 'info@hai.tech');
  vi.stubEnv('GMAIL_APP_PASSWORD', 'test-gmail-password');
  vi.stubEnv('GREEN_API_INSTANCE_ID', '7103320181');
  vi.stubEnv('GREEN_API_TOKEN', 'test-green-token');
  vi.stubEnv('FRONTEND_URL', 'https://crm.orma-ai.com');
}

describe('notifyAdminNewLead', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    sendMailMock.mockReset();
    stubRequiredEnv();
  });

  it('sends an email alert to info@hai.tech when internal WhatsApp delivery fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: vi.fn().mockResolvedValue('notAuthorized'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { notifyAdminNewLead } = await import('../notifications.js');

    await notifyAdminNewLead({
      name: 'עמי מידר',
      phone: '0528746137',
      email: 'ami@example.com',
      interest: 'אחר',
      source: 'website',
      leadAppointmentId: 'lead-123',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'info@hai.tech',
      subject: expect.stringContaining('WhatsApp לליד חדש לא נשלח'),
      html: expect.stringContaining('lead-123'),
    }));
    expect(sendMailMock.mock.calls[0][0].html).toContain('עמי');
    expect(sendMailMock.mock.calls[0][0].html).toContain('קבוצת המכירות');
  });

  it('does not send a failure email when all internal WhatsApp deliveries succeed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(''),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { notifyAdminNewLead } = await import('../notifications.js');

    await notifyAdminNewLead({
      name: 'לקוח בדיקה',
      phone: '0501234567',
      source: 'website',
      leadAppointmentId: 'lead-ok',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
