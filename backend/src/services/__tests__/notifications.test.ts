import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../green-api-client.js', () => ({
  sendGreenApiMessage: vi.fn().mockResolvedValue({ success: true, instanceId: 'test-green' }),
}));

vi.mock('../whatsapp-cloud-templates.js', async () => {
  const actual = await vi.importActual<typeof import('../whatsapp-cloud-templates.js')>('../whatsapp-cloud-templates.js');
  return {
    ...actual,
    sendWhatsAppCloudTemplate: vi.fn().mockResolvedValue({ success: true, messageId: 'wamid.test' }),
  };
});

import { sendGreenApiMessage } from '../green-api-client.js';
import { sendWhatsAppCloudTemplate } from '../whatsapp-cloud-templates.js';
import {
  buildLeadAdminTemplatePreview,
  buildLeadAdminTemplateVariables,
  notifyAdminNewLead,
} from '../notifications.js';

const lead = {
  name: 'ישראל ישראלי',
  phone: '0521234567',
  email: 'lead@example.com',
  childName: 'דנה',
  interest: 'רובלוקס',
  source: 'website',
  leadAppointmentId: 'lead-1',
};

describe('lead admin notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LEAD_ADMIN_WA_TEMPLATE_ENABLED;
    delete process.env.LEAD_ADMIN_WA_TEMPLATE_NAME;
    delete process.env.LEAD_ADMIN_WA_TEMPLATE_RECIPIENTS;
    delete process.env.LEAD_ADMIN_GREEN_FALLBACK_ENABLED;
    delete process.env.LEAD_ADMIN_WA_PHONE_NUMBER_ID;
    delete process.env.LEAD_ADMIN_WA_BUSINESS_PHONE;
    process.env.FRONTEND_URL = 'https://crm.orma-ai.com';
  });

  it('builds Meta template variables in the documented order', () => {
    expect(buildLeadAdminTemplateVariables(lead, 'https://crm.orma-ai.com/lead-appointments?id=lead-1')).toEqual([
      'ישראל ישראלי',
      '0521234567',
      'lead@example.com',
      'דנה',
      'רובלוקס',
      'website',
      'https://crm.orma-ai.com/lead-appointments?id=lead-1',
    ]);
  });

  it('uses safe fallbacks for missing lead fields', () => {
    expect(buildLeadAdminTemplateVariables({ name: '' }, '')).toEqual([
      'לא צוין',
      'לא צוין',
      'לא צוין',
      'לא צוין',
      'לא צוין',
      'website',
      'https://crm.orma-ai.com/lead-appointments',
    ]);
  });

  it('does not send Meta templates unless explicitly enabled', async () => {
    await notifyAdminNewLead(lead);

    expect(sendWhatsAppCloudTemplate).not.toHaveBeenCalled();
    expect(sendGreenApiMessage).toHaveBeenCalledTimes(3);
    expect(sendGreenApiMessage).toHaveBeenCalledWith('972543354550@c.us', expect.stringContaining('ישראל ישראלי'));
  });

  it('sends the admin template to configured direct recipients when enabled', async () => {
    process.env.LEAD_ADMIN_WA_TEMPLATE_ENABLED = 'true';
    process.env.LEAD_ADMIN_WA_TEMPLATE_NAME = 'lead_admin_new_lead';
    process.env.LEAD_ADMIN_WA_TEMPLATE_RECIPIENTS = '0528746137,0541234567';
    process.env.LEAD_ADMIN_WA_PHONE_NUMBER_ID = '171389679383708';
    process.env.LEAD_ADMIN_WA_BUSINESS_PHONE = '+972533027763';

    await notifyAdminNewLead(lead);

    expect(sendWhatsAppCloudTemplate).toHaveBeenCalledTimes(2);
    expect(sendWhatsAppCloudTemplate).toHaveBeenCalledWith(expect.objectContaining({
      phone: '0528746137',
      templateName: 'lead_admin_new_lead',
      phoneNumberId: '171389679383708',
      businessPhone: '+972533027763',
      bodyParameters: buildLeadAdminTemplateVariables(lead, 'https://crm.orma-ai.com/lead-appointments?id=lead-1'),
      preview: buildLeadAdminTemplatePreview(lead, 'https://crm.orma-ai.com/lead-appointments?id=lead-1'),
    }));
    expect(sendWhatsAppCloudTemplate).toHaveBeenCalledWith(expect.objectContaining({
      phone: '0541234567',
      templateName: 'lead_admin_new_lead',
    }));
  });

  it('labels Kim when sending the default admin template recipients', async () => {
    process.env.LEAD_ADMIN_WA_TEMPLATE_ENABLED = 'true';

    await notifyAdminNewLead(lead);

    expect(sendWhatsAppCloudTemplate).toHaveBeenCalledWith(expect.objectContaining({
      phone: '0543354550',
      contactName: 'קים נווה',
    }));
  });

  it('can disable the legacy Green notification fallback after the template is live', async () => {
    process.env.LEAD_ADMIN_WA_TEMPLATE_ENABLED = 'true';
    process.env.LEAD_ADMIN_GREEN_FALLBACK_ENABLED = 'false';

    await notifyAdminNewLead(lead);

    expect(sendWhatsAppCloudTemplate).toHaveBeenCalledTimes(2);
    expect(sendGreenApiMessage).not.toHaveBeenCalled();
  });
});
