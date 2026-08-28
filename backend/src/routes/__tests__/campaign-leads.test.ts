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

import { campaignLeadsRouter } from '../campaign-leads.js';
import { prisma } from '../../utils/prisma.js';
import { findOrCreateCustomer } from '../../utils/lead-customer.js';
import { findOrCreateLeadAppointment } from '../../utils/lead-dedup.js';
import { sendLeadWelcomeTemplate } from '../../services/lead-welcome.js';
import { autoRegisterLeadToCycle } from '../../services/lead-cycle-registration.js';

const mockPrisma = vi.mocked(prisma);
const mockFindOrCreateCustomer = vi.mocked(findOrCreateCustomer);
const mockFindOrCreateLeadAppointment = vi.mocked(findOrCreateLeadAppointment);
const mockSendLeadWelcomeTemplate = vi.mocked(sendLeadWelcomeTemplate);
const mockAutoRegisterLeadToCycle = vi.mocked(autoRegisterLeadToCycle);

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
      maxPayments: 1,
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
    expect(res.body.payment.url).toBe('http://crm.test/pl/f3627');
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
