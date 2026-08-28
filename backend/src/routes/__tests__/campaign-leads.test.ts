import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
    },
    cycle: {
      findFirst: vi.fn(),
    },
    paymentLink: {
      findFirst: vi.fn(),
    },
    campaignRecipient: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../../utils/lead-customer.js', () => ({
  findOrCreateCustomer: vi.fn(),
}));

vi.mock('../../utils/lead-dedup.js', () => ({
  findOrCreateLeadAppointment: vi.fn(),
}));

vi.mock('../../services/lead-welcome.js', () => ({
  sendLeadWelcomeTemplate: vi.fn(),
}));

vi.mock('../../services/lead-cycle-registration.js', () => ({
  autoRegisterLeadToCycle: vi.fn(),
}));

vi.mock('../../services/woo-payment-link.js', () => ({
  createWooPaymentLink: vi.fn(),
}));

import { campaignLeadsRouter } from '../campaign-leads.js';
import { prisma } from '../../utils/prisma.js';
import { findOrCreateCustomer } from '../../utils/lead-customer.js';
import { findOrCreateLeadAppointment } from '../../utils/lead-dedup.js';
import { sendLeadWelcomeTemplate } from '../../services/lead-welcome.js';
import { autoRegisterLeadToCycle } from '../../services/lead-cycle-registration.js';
import { createWooPaymentLink } from '../../services/woo-payment-link.js';

const mockPrisma = vi.mocked(prisma);
const mockFindOrCreateCustomer = vi.mocked(findOrCreateCustomer);
const mockFindOrCreateLeadAppointment = vi.mocked(findOrCreateLeadAppointment);
const mockSendLeadWelcomeTemplate = vi.mocked(sendLeadWelcomeTemplate);
const mockAutoRegisterLeadToCycle = vi.mocked(autoRegisterLeadToCycle);
const mockCreateWooPaymentLink = vi.mocked(createWooPaymentLink);

const app = express();
app.use(express.json());
app.use('/api/campaign-leads', campaignLeadsRouter);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.statusCode || 500).json({ error: err.message });
});

const campaign = {
  id: 'roblox-group-20261004',
  name: 'רובלוקס מתחילים גילאי 10-13',
  description: null,
  audienceFilters: { cycleId: 'cycle-1' },
};

const cycle = {
  id: 'cycle-1',
  name: 'רובלוקס מתחילים גילאי 10-13',
  startDate: new Date('2026-10-04T00:00:00.000Z'),
  endDate: new Date('2026-12-06T00:00:00.000Z'),
  startTime: new Date('1970-01-01T17:00:00.000Z'),
  endTime: new Date('1970-01-01T18:00:00.000Z'),
  durationMinutes: 60,
  totalMeetings: 10,
  defaultRegistrationAmount: 999,
  minimumStudentsThreshold: 6,
  isOnline: true,
  videoProvider: 'google_meet',
  zoomJoinUrl: 'https://meet.google.com/ddb-tudw-bqn',
  course: { id: 'course-1', name: 'Roblox בני 10+' },
  branch: { id: 'branch-1', name: 'אונליין B2C' },
  instructor: { id: 'instructor-1', name: 'מורין לוגסי בן הרוש' },
};

describe('campaign leads public API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.campaign.findUnique.mockResolvedValue(campaign as any);
    mockPrisma.cycle.findFirst.mockResolvedValue(cycle as any);
    mockPrisma.paymentLink.findFirst.mockResolvedValue({
      code: 'f3627',
      amount: 999,
      maxPayments: 3,
    } as any);
    mockPrisma.campaignRecipient.updateMany.mockResolvedValue({ count: 0 } as any);
    mockFindOrCreateCustomer.mockResolvedValue({ customerId: 'customer-1', isNew: true });
    mockFindOrCreateLeadAppointment.mockResolvedValue({
      lead: { id: 'lead-1' },
      isDuplicate: false,
    });
    mockAutoRegisterLeadToCycle.mockResolvedValue({
      status: 'registered',
      cycleId: 'cycle-1',
      studentId: 'student-1',
      registrationId: 'registration-1',
    });
    mockCreateWooPaymentLink.mockResolvedValue({
      paymentId: 'payment-id',
      orderId: 40510,
      orderKey: 'wc_order_key',
      paymentUrl: 'http://crm.test/pay/pay-token',
      directPaymentUrl: 'https://woo.test/checkout/order-pay/40510/?pay_for_order=true&key=wc_order_key',
      amount: 999,
      description: 'רישום למחזור רובלוקס מתחילים גילאי 10-13 - ילד אחד [cycle:cycle-1]',
      maxInstallments: 3,
      wooProductId: null,
      wooCustomerId: null,
    });
    mockSendLeadWelcomeTemplate.mockResolvedValue(undefined);
  });

  it('returns linked cycle details and payment URL for a campaign landing page', async () => {
    const res = await request(app)
      .get('/api/campaign-leads/roblox-group-20261004')
      .set('Host', 'crm.test');

    expect(res.status).toBe(200);
    expect(res.body.campaign.cycleId).toBe('cycle-1');
    expect(res.body.cycle.name).toBe('רובלוקס מתחילים גילאי 10-13');
    expect(res.body.payment.url).toBe('http://crm.test/pl/f3627');
    expect(mockPrisma.paymentLink.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { description: { contains: '[cycle:cycle-1]' } },
    }));
  });

  it('auto-registers a campaign submission to the linked cycle', async () => {
    const res = await request(app)
      .post('/api/campaign-leads')
      .set('Host', 'crm.test')
      .send({
        campaignId: 'roblox-group-20261004',
        name: 'הורה בדיקה',
        phone: '0501234567',
        email: 'parent@example.com',
        childName: 'ילד בדיקה',
        childAge: '10',
        grade: 'ה',
      });

    expect(res.status).toBe(201);
    expect(res.body.registration).toEqual(expect.objectContaining({
      status: 'registered',
      registrationId: 'registration-1',
    }));
    expect(res.body.payment.url).toBe('http://crm.test/pay/pay-token');
    expect(mockCreateWooPaymentLink).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'customer-1',
      customerName: 'הורה בדיקה',
      customerPhone: '0501234567',
      customerEmail: 'parent@example.com',
      amount: 999,
      installments: 3,
      baseUrl: 'http://crm.test',
    }));
    expect(mockFindOrCreateCustomer).toHaveBeenCalledWith(expect.objectContaining({
      source: 'campaign:roblox-group-20261004',
      childName: 'ילד בדיקה',
      childAge: '10',
    }));
    expect(mockFindOrCreateLeadAppointment).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: 'roblox-group-20261004',
      campaignName: 'רובלוקס מתחילים גילאי 10-13',
      childName: 'ילד בדיקה',
    }));
    expect(mockAutoRegisterLeadToCycle).toHaveBeenCalledWith(expect.objectContaining({
      source: 'campaign:roblox-group-20261004',
      customerId: 'customer-1',
      cycleId: 'cycle-1',
      childName: 'ילד בדיקה',
      childAge: '10',
      grade: 'ה',
    }));
  });

  it('auto-registers multiple children from one campaign submission', async () => {
    mockAutoRegisterLeadToCycle
      .mockResolvedValueOnce({
        status: 'registered',
        cycleId: 'cycle-1',
        studentId: 'student-1',
        registrationId: 'registration-1',
      })
      .mockResolvedValueOnce({
        status: 'registered',
        cycleId: 'cycle-1',
        studentId: 'student-2',
        registrationId: 'registration-2',
      });
    mockCreateWooPaymentLink.mockResolvedValue({
      paymentId: 'payment-id',
      orderId: 40511,
      orderKey: 'wc_order_key_2',
      paymentUrl: 'http://crm.test/pay/pay-token-2',
      directPaymentUrl: 'https://woo.test/checkout/order-pay/40511/?pay_for_order=true&key=wc_order_key_2',
      amount: 1998,
      description: 'רישום למחזור רובלוקס מתחילים גילאי 10-13 - 2 ילדים [cycle:cycle-1]',
      maxInstallments: 3,
      wooProductId: null,
      wooCustomerId: null,
    });

    const res = await request(app)
      .post('/api/campaign-leads')
      .set('Host', 'crm.test')
      .send({
        campaignId: 'roblox-group-20261004',
        name: 'הורה בדיקה',
        phone: '0501234567',
        email: 'parent@example.com',
        children: [
          { childName: 'ילד ראשון', childAge: '10', grade: 'ה' },
          { childName: 'ילד שני', childAge: '12', grade: 'ז' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.registrations).toHaveLength(2);
    expect(res.body.payment.url).toBe('http://crm.test/pay/pay-token-2');
    expect(res.body.payment.amount).toBe(1998);
    expect(res.body.registrations.map((reg: { registrationId: string }) => reg.registrationId)).toEqual([
      'registration-1',
      'registration-2',
    ]);
    expect(mockCreateWooPaymentLink).toHaveBeenCalledWith(expect.objectContaining({
      amount: 1998,
      description: expect.stringContaining('2 ילדים'),
    }));
    expect(mockFindOrCreateCustomer).toHaveBeenCalledWith(expect.objectContaining({
      childName: 'ילד ראשון',
      childAge: '10',
    }));
    expect(mockFindOrCreateLeadAppointment).toHaveBeenCalledWith(expect.objectContaining({
      childName: 'ילד ראשון, ילד שני',
    }));
    expect(mockAutoRegisterLeadToCycle).toHaveBeenNthCalledWith(1, expect.objectContaining({
      childName: 'ילד ראשון',
      childAge: '10',
      grade: 'ה',
    }));
    expect(mockAutoRegisterLeadToCycle).toHaveBeenNthCalledWith(2, expect.objectContaining({
      childName: 'ילד שני',
      childAge: '12',
      grade: 'ז',
    }));
  });

  it('requires child name for cycle-linked campaign registration', async () => {
    const res = await request(app)
      .post('/api/campaign-leads')
      .send({
        campaignId: 'roblox-group-20261004',
        name: 'הורה בדיקה',
        phone: '0501234567',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('שם הילד');
    expect(mockFindOrCreateCustomer).not.toHaveBeenCalled();
  });
});
