import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    leadAppointment: { findMany: vi.fn(), findFirst: vi.fn() },
    leadActivity: { findMany: vi.fn(), create: vi.fn() },
    waMessage: { findFirst: vi.fn() },
  },
}));

vi.mock('../lead-payment-evidence.js', () => ({
  findPaymentEvidence: vi.fn(),
}));

vi.mock('../whatsapp-cloud-templates.js', async () => {
  const actual = await vi.importActual<any>('../whatsapp-cloud-templates.js');
  return { ...actual, sendWhatsAppCloudTemplate: vi.fn() };
});

import { prisma } from '../../utils/prisma.js';
import { findPaymentEvidence } from '../lead-payment-evidence.js';
import { sendWhatsAppCloudTemplate } from '../whatsapp-cloud-templates.js';
import {
  MAX_AGE_MS,
  MIN_AGE_MS,
  NUDGE_FAILED_NOTE_PREFIX,
  NUDGE_SENT_NOTE,
  buildLmsNudgePayload,
  firstNameOf,
  getLmsNudgeSkipReason,
  isWithinLmsNudgeSendWindow,
  runLmsSignupNudge,
} from '../lms-signup-nudge.js';

const mockPrisma = vi.mocked(prisma) as any;
const mockEvidence = vi.mocked(findPaymentEvidence);
const mockSend = vi.mocked(sendWhatsAppCloudTemplate);

// Wednesday 2026-11-04 12:00 Israel (UTC+2)
const NOW = new Date('2026-11-04T10:00:00Z');

function lead(overrides: Record<string, any> = {}) {
  return {
    id: 'lead-1',
    customerId: 'cust-1',
    customerName: 'אייל קשת',
    customerPhone: '050-1234567',
    customerEmail: 'eyal@example.com',
    createdAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LMS_SIGNUP_NUDGE;
  delete process.env.LMS_SIGNUP_NUDGE_WA_TEMPLATE_NAME;
  mockPrisma.leadAppointment.findMany.mockResolvedValue([lead()]);
  mockPrisma.leadAppointment.findFirst.mockResolvedValue(null);
  mockPrisma.leadActivity.findMany.mockResolvedValue([]);
  mockPrisma.leadActivity.create.mockResolvedValue({ id: 'act-1' });
  mockPrisma.waMessage.findFirst.mockResolvedValue(null);
  mockEvidence.mockResolvedValue(null);
  mockSend.mockResolvedValue({ success: true, messageId: 'wamid-1' });
});

describe('send window (Asia/Jerusalem)', () => {
  const at = (iso: string) => new Date(iso);
  it('allows 09:00-20:00 on weekdays', () => {
    expect(isWithinLmsNudgeSendWindow(at('2026-11-04T07:00:00Z'))).toBe(true); // Wed 09:00
    expect(isWithinLmsNudgeSendWindow(at('2026-11-04T17:59:00Z'))).toBe(true); // Wed 19:59
    expect(isWithinLmsNudgeSendWindow(at('2026-11-08T07:10:00Z'))).toBe(true); // Sun 09:10
  });
  it('blocks quiet hours', () => {
    expect(isWithinLmsNudgeSendWindow(at('2026-11-04T06:59:00Z'))).toBe(false); // Wed 08:59
    expect(isWithinLmsNudgeSendWindow(at('2026-11-04T18:00:00Z'))).toBe(false); // Wed 20:00
    expect(isWithinLmsNudgeSendWindow(at('2026-11-04T23:00:00Z'))).toBe(false); // Thu 01:00
  });
  it('blocks Friday from 14:00 and all of Saturday', () => {
    expect(isWithinLmsNudgeSendWindow(at('2026-11-06T11:30:00Z'))).toBe(true); // Fri 13:30
    expect(isWithinLmsNudgeSendWindow(at('2026-11-06T12:00:00Z'))).toBe(false); // Fri 14:00
    expect(isWithinLmsNudgeSendWindow(at('2026-11-07T10:00:00Z'))).toBe(false); // Sat 12:00
    expect(isWithinLmsNudgeSendWindow(at('2026-11-07T17:00:00Z'))).toBe(false); // Sat 19:00
  });
  it('uses Israel summer time correctly (UTC+3)', () => {
    expect(isWithinLmsNudgeSendWindow(at('2026-07-01T06:00:00Z'))).toBe(true); // Wed 09:00 IDT
    expect(isWithinLmsNudgeSendWindow(at('2026-07-01T05:59:00Z'))).toBe(false); // Wed 08:59 IDT
  });
  it('a Friday-evening signup is still inside the 72h window on Sunday morning', () => {
    const signup = at('2026-11-06T17:00:00Z'); // Fri 19:00
    const sunday = at('2026-11-08T07:00:00Z'); // Sun 09:00
    expect(isWithinLmsNudgeSendWindow(sunday)).toBe(true);
    expect(sunday.getTime() - signup.getTime()).toBeLessThan(MAX_AGE_MS);
  });
});

describe('payload', () => {
  it('uses first name + LMS link and the full preview text', () => {
    const p = buildLmsNudgePayload(lead());
    expect(p.templateName).toBe('lms_signup_no_purchase');
    expect(p.bodyParameters).toEqual(['אייל', 'https://hai.tech/lms/']);
    expect(p.phone).toBe('050-1234567');
    expect(p.contactName).toBe('אייל קשת');
    expect(p.preview).toBe(
      'היי אייל, ראינו שנרשמת לאתר הלמידה של דרך ההייטק 🙌 יש שאלה על הקורסים, או שנעזור לבחור את המתאים? ' +
        'אפשר פשוט להשיב כאן ונשמח לעזור. לכל הקורסים: https://hai.tech/lms/ נשמח לשמוע ממך 💙',
    );
  });
  it('falls back to שלום and honors the template env override', () => {
    process.env.LMS_SIGNUP_NUDGE_WA_TEMPLATE_NAME = 'custom_tpl';
    const p = buildLmsNudgePayload(lead({ customerName: '  ' }));
    expect(p.bodyParameters[0]).toBe('שלום');
    expect(p.templateName).toBe('custom_tpl');
    expect(firstNameOf(null)).toBe('שלום');
  });
});

describe('eligibility', () => {
  it('queries website-lms leads created 60m-72h ago, open, with phone', async () => {
    await runLmsSignupNudge(NOW);
    const where = mockPrisma.leadAppointment.findMany.mock.calls[0][0].where;
    expect(where.source).toBe('website-lms');
    expect(where.createdAt.lte.getTime()).toBe(NOW.getTime() - MIN_AGE_MS);
    expect(where.createdAt.gte.getTime()).toBe(NOW.getTime() - MAX_AGE_MS);
    expect(where.salesStatus).toEqual({ notIn: ['converted', 'not_relevant'] });
    expect(where.customerPhone).toEqual({ not: '' });
  });

  it('eligible lead → null skip reason', async () => {
    expect(await getLmsNudgeSkipReason(lead(), NOW)).toBeNull();
  });

  it('already bought (payment evidence) → skip', async () => {
    mockEvidence.mockResolvedValue({ kind: 'payment', id: 'pay-1' });
    expect(await getLmsNudgeSkipReason(lead(), NOW)).toBe('paid');
  });

  it('purchase-form lead for the same person → skip', async () => {
    mockPrisma.leadAppointment.findFirst.mockResolvedValue({ id: 'lead-2' });
    expect(await getLmsNudgeSkipReason(lead(), NOW)).toBe('purchase_form');
    const where = mockPrisma.leadAppointment.findFirst.mock.calls[0][0].where;
    expect(where.source).toBe('purchase-form');
    expect(where.OR).toEqual(expect.arrayContaining([{ customerId: 'cust-1' }]));
  });

  it('already nudged → skip', async () => {
    mockPrisma.leadActivity.findMany.mockResolvedValue([{ note: NUDGE_SENT_NOTE }]);
    expect(await getLmsNudgeSkipReason(lead(), NOW)).toBe('already_nudged');
  });

  it('3 failed attempts → stop retrying', async () => {
    const fail = { note: `${NUDGE_FAILED_NOTE_PREFIX}: x` };
    mockPrisma.leadActivity.findMany.mockResolvedValue([fail, fail]);
    expect(await getLmsNudgeSkipReason(lead(), NOW)).toBeNull();
    mockPrisma.leadActivity.findMany.mockResolvedValue([fail, fail, fail]);
    expect(await getLmsNudgeSkipReason(lead(), NOW)).toBe('max_attempts');
  });

  it('recent WhatsApp conversation (48h) on any phone format → skip', async () => {
    mockPrisma.waMessage.findFirst.mockResolvedValue({ id: 'm-1' });
    expect(await getLmsNudgeSkipReason(lead(), NOW)).toBe('recent_conversation');
    const where = mockPrisma.waMessage.findFirst.mock.calls[0][0].where;
    expect(where.conversation.phone.in).toEqual(expect.arrayContaining(['972501234567', '0501234567']));
    expect(where.createdAt.gte.getTime()).toBe(NOW.getTime() - 48 * 60 * 60 * 1000);
  });
});

describe('runLmsSignupNudge', () => {
  it('sends once and records the sent activity', async () => {
    const r = await runLmsSignupNudge(NOW);
    expect(r).toMatchObject({ candidates: 1, sent: 1, failed: 0 });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toMatchObject({ templateName: 'lms_signup_no_purchase', bodyParameters: ['אייל', 'https://hai.tech/lms/'] });
    expect(mockPrisma.leadActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ leadAppointmentId: 'lead-1', type: 'whatsapp', result: 'whatsapp_sent', note: NUDGE_SENT_NOTE }),
    });
  });

  it('is idempotent: second run after the marker exists does not send', async () => {
    await runLmsSignupNudge(NOW);
    mockPrisma.leadActivity.findMany.mockResolvedValue([{ note: NUDGE_SENT_NOTE }]);
    const r = await runLmsSignupNudge(new Date(NOW.getTime() + 10 * 60 * 1000));
    expect(r.sent).toBe(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('sends at most one message per phone per run', async () => {
    mockPrisma.leadAppointment.findMany.mockResolvedValue([lead(), lead({ id: 'lead-2', customerPhone: '972501234567' })]);
    const r = await runLmsSignupNudge(NOW);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(r.ineligible).toBe(1);
  });

  it('failed send is recorded as failed (not as sent) and does not throw', async () => {
    mockSend.mockResolvedValue({ success: false, error: 'template not approved' });
    const r = await runLmsSignupNudge(NOW);
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    const data = mockPrisma.leadActivity.create.mock.calls[0][0].data;
    expect(data.result).toBe('whatsapp_failed');
    expect(data.note.startsWith(NUDGE_FAILED_NOTE_PREFIX)).toBe(true);
    expect(data.note).not.toBe(NUDGE_SENT_NOTE);
  });

  it('swallows DB errors', async () => {
    mockPrisma.leadAppointment.findMany.mockRejectedValue(new Error('db down'));
    await expect(runLmsSignupNudge(NOW)).resolves.toMatchObject({ sent: 0 });
    mockPrisma.leadAppointment.findMany.mockResolvedValue([lead()]);
    mockEvidence.mockRejectedValue(new Error('boom'));
    await expect(runLmsSignupNudge(NOW)).resolves.toMatchObject({ failed: 1, sent: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does nothing outside the window or when disabled', async () => {
    expect((await runLmsSignupNudge(new Date('2026-11-07T10:00:00Z'))).skipped).toBe('outside_window');
    process.env.LMS_SIGNUP_NUDGE = 'off';
    expect((await runLmsSignupNudge(NOW)).skipped).toBe('disabled');
    expect(mockPrisma.leadAppointment.findMany).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
