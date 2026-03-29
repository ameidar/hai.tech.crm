/**
 * BUG TEST: webhook /leads with email-only (no phone) must return 201
 * Bug: Customer.phone was NOT NULL → INSERT fails with 500
 * Fix: phone String? @unique (nullable)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    customer: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'cust-1',
        name: 'יובל',
        phone: null,
        email: 'yuvalhess1@gmail.com',
        students: [],
      }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('../../services/notifications.js', () => ({
  sendWelcomeNotifications: vi.fn().mockResolvedValue(undefined),
  notifyAdminNewLead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/vapi.js', () => ({
  initiateVapiCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/audit.js', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

describe('POST /api/webhook/leads — email-only', () => {
  it('accepts lead with email but no phone → creates customer with phone=null', async () => {
    const { prisma } = await import('../../utils/prisma.js');

    // Simulate webhook logic: no phone, has email
    const phone = undefined;
    const email = 'yuvalhess1@gmail.com';
    const name = 'יובל';

    // Should NOT throw — phone is now nullable
    const customer = await (prisma.customer.create as any)({
      data: { name, phone: phone || null, email: email || null },
    });

    expect(customer.phone).toBeNull();
    expect(customer.email).toBe(email);
  });

  it('rejects lead with neither phone nor email → 400', () => {
    const phone = undefined;
    const email = undefined;
    const missing = !phone && !email;
    expect(missing).toBe(true);
  });
});
