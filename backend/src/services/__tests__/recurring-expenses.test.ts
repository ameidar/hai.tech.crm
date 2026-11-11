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
  computeSupplierGridCells,
  detectRecurringCandidates,
  findMissingRecurring,
  gridMonths,
  isExpectedInMonth,
  matchesSupplier,
  normalizeSupplierName,
  runRecurringDetection,
  sendDraftsApprovalReminder,
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
  delete process.env.COMPANY_EXPENSE_DRAFTS_REMINDER_PHONE;
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

describe('supplier aliases', () => {
  it('normalizes quotes, punctuation and case', () => {
    expect(normalizeSupplierName(' "Twillio ')).toBe('twillio');
    expect(normalizeSupplierName('Uber B.V.')).toBe('uber b v');
    expect(normalizeSupplierName('OpenAI OpCo, LLC')).toBe('openai opco llc');
  });

  it('matches by supplier id/name or an explicit alias only', () => {
    const chatgpt = rec({ supplierId: 'oa', supplierName: 'ChatGPT', aliases: ['Uber B.V.'] });
    expect(matchesSupplier(chatgpt, { supplierId: 'oa', supplierName: 'whatever' })).toBe(true);
    // Different Morning supplier id, but the OCR name is a listed alias.
    expect(matchesSupplier(chatgpt, { supplierId: 'uber', supplierName: 'uber b.v' })).toBe(true);
    // Same OCR name does not match a supplier that doesn't list it.
    expect(matchesSupplier(rec({ supplierId: 'gg', supplierName: 'Google', aliases: [] }), { supplierId: 'uber', supplierName: 'Uber B.V.' })).toBe(false);
    expect(matchesSupplier(rec({ supplierId: 'tw', supplierName: 'Twilio', aliases: ['twillio'] }), { supplierId: null, supplierName: '"twillio' })).toBe(true);
  });

  it('counts an alias-matched draft as received in the missing check', () => {
    const r = rec({ supplierId: 'oa', supplierName: 'ChatGPT', aliases: ['Uber B.V.'], tolerancePct: null, createdAt: day('2026-11-01') });
    const draft = exp({ supplierId: 'uber', supplierName: 'Uber B.V.', date: day('2026-11-04'), isDraft: true });
    expect(findMissingRecurring([r], [], at('2026-11-20'))).toHaveLength(1);
    expect(findMissingRecurring([r], [draft], at('2026-11-20'))).toEqual([]);
  });
});

describe('cadence', () => {
  it('expects monthly every month, yearly only in expectedMonth, usage never', () => {
    expect(isExpectedInMonth({ cadence: 'monthly' }, '2026-03')).toBe(true);
    expect(isExpectedInMonth({ cadence: null }, '2026-03')).toBe(true);
    expect(isExpectedInMonth({ cadence: 'yearly', expectedMonth: 3 }, '2026-03')).toBe(true);
    expect(isExpectedInMonth({ cadence: 'yearly', expectedMonth: 3 }, '2026-04')).toBe(false);
    expect(isExpectedInMonth({ cadence: 'yearly', expectedMonth: null }, '2026-03')).toBe(false);
    expect(isExpectedInMonth({ cadence: 'usage' }, '2026-03')).toBe(false);
  });

  it('never reports usage suppliers and reports yearly only in their month', () => {
    const now = at('2026-11-20'); // checks 2026-10 and 2026-11
    expect(findMissingRecurring([rec({ cadence: 'usage' })], [], now)).toEqual([]);
    expect(findMissingRecurring([rec({ cadence: 'yearly', expectedMonth: 3 })], [], now)).toEqual([]);
    expect(findMissingRecurring([rec({ cadence: 'yearly', expectedMonth: 10 })], [], now)).toEqual([
      expect.objectContaining({ month: '2026-10' }),
    ]);
  });
});

describe('computeSupplierGridCells', () => {
  const NOW = at('2026-11-08'); // day 8 — current-month due day 5 + grace 5 not passed yet
  const months = gridMonths(4, NOW);

  it('builds month keys ending with the current Israel month', () => {
    expect(months).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
  });

  it('prefers approved over pending over draft and sums matches', () => {
    const rows = [
      exp({ id: 'a1', date: day('2026-08-05'), status: 20 }),
      exp({ id: 'a2', date: day('2026-08-20'), isDraft: true, amount: 50 }),
      exp({ id: 'p1', date: day('2026-09-05'), status: 10 }),
      exp({ id: 'd1', date: day('2026-10-05'), isDraft: true, status: 0 }),
    ];
    const cells = computeSupplierGridCells(rec({ tolerancePct: null }), rows, months, NOW);
    expect(cells['2026-08']).toEqual({ state: 'approved', count: 2, gross: 150, expenseIds: ['a1', 'a2'] });
    expect(cells['2026-09'].state).toBe('pending');
    expect(cells['2026-10']).toMatchObject({ state: 'draft', count: 1, expenseIds: ['d1'] });
    expect(cells['2026-11']).toEqual({ state: 'not_due', count: 0, gross: 0, expenseIds: [] });
  });

  it('marks missing past months and the current month once past due + grace', () => {
    const cells = computeSupplierGridCells(rec(), [], months, at('2026-11-11'));
    expect(Object.values(cells).map((c) => c.state)).toEqual(['missing', 'missing', 'missing', 'missing']);
  });

  it('uses not_expected for usage and off-month yearly suppliers, but still shows their invoices', () => {
    const usage = computeSupplierGridCells(rec({ cadence: 'usage' }), [exp({ id: 'u', date: day('2026-09-02') })], months, NOW);
    expect(Object.values(usage).map((c) => c.state)).toEqual(['not_expected', 'approved', 'not_expected', 'not_expected']);
    const yearly = computeSupplierGridCells(rec({ cadence: 'yearly', expectedMonth: 9 }), [], months, NOW);
    expect(Object.values(yearly).map((c) => c.state)).toEqual(['not_expected', 'missing', 'not_expected', 'not_expected']);
  });
});

describe('missing reminder grouping', () => {
  it('groups by invoice source and lists portal links on their own line', () => {
    const base = { supplierName: 's', expectedDayOfMonth: 1, expectedAmount: null, tolerancePct: null, daysOverdue: 9, month: '2026-11' };
    const msg = buildMissingReminderMessage([
      { ...base, id: '1', label: 'Hostinger', invoiceSource: 'portal', portalUrl: 'https://hpanel.hostinger.com/billing' },
      { ...base, id: '2', label: 'Hetzner', invoiceSource: 'email', portalUrl: 'https://ignored.example' },
      { ...base, id: '3', label: 'Vimeo', invoiceSource: null, portalUrl: null, owner: 'אינה' },
    ]);
    const lines = msg.split('\n');
    const portalIdx = lines.findIndex((l) => l.includes('פורטל'));
    const emailIdx = lines.findIndex((l) => l.includes('במייל'));
    expect(portalIdx).toBeGreaterThan(-1);
    expect(emailIdx).toBeGreaterThan(portalIdx);
    expect(lines[lines.indexOf('• Hostinger (11/2026)') + 1]).toBe('https://hpanel.hostinger.com/billing');
    expect(msg).toContain('• Vimeo (11/2026) · אינה'); // no source → portal group
    expect(msg).not.toContain('ignored.example');
    expect(lines.at(-1)).toBe('https://crm.orma-ai.com/company-expenses');
  });
});

describe('drafts approval reminder', () => {
  it('skips when there are no drafts', async () => {
    mockPrisma.companyExpense.findMany.mockResolvedValue([] as never);
    expect(await sendDraftsApprovalReminder()).toEqual({ sent: false, drafts: 0, gross: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends count + total to Inna (or the env override)', async () => {
    mockPrisma.companyExpense.findMany.mockResolvedValue([{ amount: { toString: () => '1000.40' } }, { amount: 234 }] as never);
    const result = await sendDraftsApprovalReminder();
    expect(result).toEqual({ sent: true, drafts: 2, gross: 1234.4 });
    expect(mockPrisma.companyExpense.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true, isDraft: true } }));
    const [phone, message] = mockSend.mock.calls[0];
    expect(phone).toBe('972524486208');
    expect(message).toContain('יש 2 טיוטות הוצאה ב-Morning שממתינות לאישור');
    expect(message).toContain('₪1,234');

    process.env.COMPANY_EXPENSE_DRAFTS_REMINDER_PHONE = '972500000000';
    await sendDraftsApprovalReminder();
    expect(mockSend.mock.calls[1][0]).toBe('972500000000');
  });
});
