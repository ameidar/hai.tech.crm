import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    companyExpense: { findMany: vi.fn() },
    recurringExpense: { findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('../notifications.js', () => ({
  ADMIN_PHONE: '0528746137',
  sendWhatsAppMessage: vi.fn(async () => true),
}));

vi.mock('../morning/client.js', () => ({
  isMorningConfigured: vi.fn(() => true),
  morningRequest: vi.fn(),
}));

import { prisma } from '../../utils/prisma.js';
import { sendWhatsAppMessage } from '../notifications.js';
import type { ExpenseRowLike } from '../company-expenses.js';
import {
  buildMissingReminderMessage,
  detectRecurringCandidates,
  findMissingRecurring,
  runRecurringDetection,
  sendMissingRecurringReminder,
  type RecurringLike,
} from '../recurring-expenses.js';

const mockPrisma = vi.mocked(prisma, true);
const mockSend = vi.mocked(sendWhatsAppMessage);

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
// Israel noon on the given date
const at = (s: string) => new Date(`${s}T10:00:00.000Z`);

const exp = (o: Partial<ExpenseRowLike>): ExpenseRowLike => ({
  status: 20, date: day('2026-10-05'), reportingDate: null, amount: 100, amountExcludeVat: null, vat: null,
  supplierId: 'hz', supplierName: 'Hetzner', categoryTitle: 'מחשוב', active: true, ...o,
});

const rec = (o: Partial<RecurringLike> = {}): RecurringLike => ({
  id: 'r1', supplierId: 'hz', supplierName: 'Hetzner', label: 'שרתים Hetzner',
  expectedDayOfMonth: 5, expectedAmount: 100, tolerancePct: 20, status: 'active',
  createdAt: day('2026-01-01'), ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FRONTEND_URL;
});

describe('detectRecurringCandidates', () => {
  const NOW = at('2026-11-09'); // window = 2026-05 .. 2026-10

  it('suggests suppliers seen in ≥4 of the last 6 full months with a stable amount', () => {
    const rows = [
      exp({ date: day('2026-05-04'), amount: 100 }),
      exp({ date: day('2026-06-05'), amount: 105 }),
      exp({ date: day('2026-07-06'), amount: 95 }),
      exp({ date: day('2026-09-05'), amount: 110 }),
      // current month is ignored for detection
      exp({ date: day('2026-11-02'), amount: 9999 }),
    ];
    const [c, ...rest] = detectRecurringCandidates(rows, NOW);
    expect(rest).toHaveLength(0);
    expect(c).toMatchObject({
      supplierId: 'hz', supplierName: 'Hetzner', expectedDayOfMonth: 5,
      expectedAmount: 102.5, monthsSeen: 4, categoryTitle: 'מחשוב',
    });
    expect(c.tolerancePct).toBeGreaterThanOrEqual(10);
  });

  it('requires 4 distinct months (multiple docs in one month count once)', () => {
    const rows = [
      exp({ date: day('2026-05-04') }), exp({ date: day('2026-05-20') }),
      exp({ date: day('2026-06-05') }), exp({ date: day('2026-07-05') }),
    ];
    expect(detectRecurringCandidates(rows, NOW)).toEqual([]);
  });

  it('skips suppliers whose monthly amounts are unstable', () => {
    const rows = [100, 900, 30, 400, 2000].map((amount, i) =>
      exp({ date: day(`2026-0${5 + i}-05`), amount }));
    expect(detectRecurringCandidates(rows, NOW)).toEqual([]);
  });
});

describe('runRecurringDetection', () => {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08'];
  const rowsFor = (supplierId: string, supplierName: string) =>
    months.map((m) => exp({ supplierId, supplierName, date: day(`${m}-10`), amount: 50 }));

  it('creates suggestions but never resurrects ignored rows or duplicates existing ones', async () => {
    mockPrisma.companyExpense.findMany.mockResolvedValue([
      ...rowsFor('hz', 'Hetzner'),
      ...rowsFor('gg', 'Google'),
      ...rowsFor('zm', 'Zoom'),
    ] as never);
    mockPrisma.recurringExpense.findMany.mockResolvedValue([
      { id: 'a', supplierId: 'hz', supplierName: 'Hetzner' }, // ignored by admin
      { id: 'b', supplierId: null, supplierName: 'google' }, // manual, name match
    ] as never);

    const result = await runRecurringDetection(at('2026-11-09'));

    expect(result).toMatchObject({ candidates: 3, created: 1 });
    expect(mockPrisma.recurringExpense.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.recurringExpense.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ supplierId: 'zm', supplierName: 'Zoom', status: 'suggested', source: 'auto', expectedDayOfMonth: 10 }),
    });
  });
});

describe('findMissingRecurring', () => {
  it('flags the current month only after expectedDay + grace', () => {
    const r = rec({ createdAt: day('2026-11-01') }); // skip previous-month check
    expect(findMissingRecurring([r], [], at('2026-11-10'))).toEqual([]); // day 10 = 5 + 5
    const missing = findMissingRecurring([r], [], at('2026-11-11'));
    expect(missing).toEqual([expect.objectContaining({ id: 'r1', month: '2026-11', daysOverdue: 6 })]);
    expect(findMissingRecurring([r], [], at('2026-11-08'), 2)).toHaveLength(1); // custom grace
  });

  it('is satisfied by a same-supplier expense within tolerance in that month', () => {
    const r = rec({ createdAt: day('2026-11-01') });
    const now = at('2026-11-20');
    expect(findMissingRecurring([r], [exp({ date: day('2026-11-03'), amount: 115 })], now)).toEqual([]);
    // outside 20% tolerance
    expect(findMissingRecurring([r], [exp({ date: day('2026-11-03'), amount: 130 })], now)).toHaveLength(1);
    // reporting month wins over doc date
    expect(findMissingRecurring([r], [exp({ date: day('2026-10-30'), reportingDate: day('2026-11-01') })], now)).toEqual([]);
    // other supplier / inactive do not count
    expect(findMissingRecurring([r], [exp({ date: day('2026-11-03'), supplierId: 'x', supplierName: 'X' })], now)).toHaveLength(1);
    expect(findMissingRecurring([r], [exp({ date: day('2026-11-03'), active: false })], now)).toHaveLength(1);
  });

  it('accepts any amount when tolerance is null and matches by name without supplier id', () => {
    const r = rec({ supplierId: null, supplierName: 'hetzner', tolerancePct: null, createdAt: day('2026-11-01') });
    expect(findMissingRecurring([r], [exp({ date: day('2026-11-03'), amount: 5000 })], at('2026-11-20'))).toEqual([]);
  });

  it('flags a missing previous-month invoice (reminder on the 3rd) and ignores non-active rows', () => {
    const now = at('2026-11-03');
    const active = rec();
    const suggested = rec({ id: 'r2', status: 'suggested' });
    const ignored = rec({ id: 'r3', status: 'ignored' });
    const missing = findMissingRecurring([active, suggested, ignored], [], now);
    expect(missing).toEqual([expect.objectContaining({ id: 'r1', month: '2026-10' })]);
    expect(findMissingRecurring([active], [exp({ date: day('2026-10-06') })], now)).toEqual([]);
  });

  it('applies the grace period to a late-month due day in the previous month', () => {
    const r = rec({ expectedDayOfMonth: 30 }); // due 2026-10-30
    expect(findMissingRecurring([r], [], at('2026-11-03'))).toEqual([]); // 4 days late ≤ grace 5
    expect(findMissingRecurring([r], [], at('2026-11-05'))).toEqual([
      expect.objectContaining({ month: '2026-10', daysOverdue: 6 }),
    ]);
  });
});

describe('missing-invoice reminder', () => {
  it('skips sending when nothing is missing', async () => {
    mockPrisma.recurringExpense.findMany.mockResolvedValue([] as never);
    mockPrisma.companyExpense.findMany.mockResolvedValue([] as never);
    const result = await sendMissingRecurringReminder(at('2026-11-15'));
    expect(result).toEqual({ sent: false, missing: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends a short Hebrew message with the page link to Ami only', async () => {
    mockPrisma.recurringExpense.findMany.mockResolvedValue([rec({ expectedAmount: { toString: () => '1234.00' } })] as never);
    mockPrisma.companyExpense.findMany.mockResolvedValue([] as never);
    const result = await sendMissingRecurringReminder(at('2026-11-15'));
    expect(result).toEqual({ sent: true, missing: 2 });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [phone, message] = mockSend.mock.calls[0];
    expect(phone).toBe('0528746137');
    expect(message).toContain('חשבוניות קבועות שעדיין לא הגיעו (2)');
    expect(message).toContain('שרתים Hetzner (10/2026)');
    expect(message).toContain('שרתים Hetzner (11/2026)');
    expect(message).toContain('https://crm.orma-ai.com/company-expenses');
  });

  it('uses FRONTEND_URL for the link', () => {
    process.env.FRONTEND_URL = 'https://dev.example.com';
    const msg = buildMissingReminderMessage([
      { id: 'r', label: 'Zoom', supplierName: 'Zoom', month: '2026-11', expectedDayOfMonth: 1, expectedAmount: null, tolerancePct: null, daysOverdue: 9 },
    ]);
    expect(msg).toContain('• Zoom (11/2026)');
    expect(msg).toContain('https://dev.example.com/company-expenses');
  });
});
