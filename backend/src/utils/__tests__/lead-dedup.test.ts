/**
 * Tests for lead-dedup utility
 * Bug: duplicate LeadAppointment records created when customer contacts via
 * multiple channels (WhatsApp + website form).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
const mockCreate = vi.fn();
const mockFindUnique = vi.fn();
const mockExecuteRaw = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock('../prisma.js', () => ({
  prisma: {
    leadAppointment: {
      create: mockCreate,
      findUnique: mockFindUnique,
    },
    $queryRaw: mockQueryRaw,
    $executeRaw: mockExecuteRaw,
  },
}));

// Import after mocking
const { findOrCreateLeadAppointment } = await import('../lead-dedup.js');

const baseLead = {
  customerName: 'אמיר נוטמן',
  customerPhone: '0527360285',
  source: 'pesach-camp',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findOrCreateLeadAppointment', () => {
  it('creates new lead when no existing record found', async () => {
    mockQueryRaw.mockResolvedValueOnce([]); // no existing lead
    mockCreate.mockResolvedValueOnce({ id: 'lead-1', source: 'pesach-camp', appointmentStatus: 'pending' });

    const result = await findOrCreateLeadAppointment(baseLead);

    expect(result.isDuplicate).toBe(false);
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('merges into existing lead when same phone found (dedup)', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { id: 'lead-1', source: 'pesach-camp', appointment_status: 'pending', appointment_notes: 'original note' },
    ]);
    mockExecuteRaw.mockResolvedValueOnce(undefined);
    mockFindUnique.mockResolvedValueOnce({ id: 'lead-1', source: 'pesach-camp', appointmentStatus: 'pending', appointmentNotes: 'merged' });

    const result = await findOrCreateLeadAppointment({
      ...baseLead,
      source: 'whatsapp',
    });

    expect(result.isDuplicate).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
    expect(result.lead.id).toBe('lead-1');
  });

  it('deduplicates across different sources (WhatsApp + form)', async () => {
    // Simulate: first call = WhatsApp, second call = pesach-camp same phone
    mockQueryRaw
      .mockResolvedValueOnce([]) // first call — no existing
      .mockResolvedValueOnce([   // second call — finds existing
        { id: 'wa-lead', source: 'whatsapp', appointment_status: 'pending', appointment_notes: null },
      ]);

    mockCreate.mockResolvedValueOnce({ id: 'wa-lead', source: 'whatsapp', appointmentStatus: 'pending' });
    mockExecuteRaw.mockResolvedValueOnce(undefined);
    mockFindUnique.mockResolvedValueOnce({ id: 'wa-lead', source: 'whatsapp', appointmentStatus: 'pending' });

    // First: WhatsApp creates lead
    const r1 = await findOrCreateLeadAppointment({ ...baseLead, source: 'whatsapp' });
    expect(r1.isDuplicate).toBe(false);

    // Second: pesach-camp form → should merge, not create new
    const r2 = await findOrCreateLeadAppointment({ ...baseLead, source: 'pesach-camp' });
    expect(r2.isDuplicate).toBe(true);
    expect(mockCreate).toHaveBeenCalledOnce(); // only one create total
  });

  it('creates new lead when phone is missing', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'lead-2', source: 'website', appointmentStatus: 'pending' });

    const result = await findOrCreateLeadAppointment({
      customerName: 'ללא טלפון',
      customerPhone: '',
      source: 'website',
    });

    expect(result.isDuplicate).toBe(false);
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockQueryRaw).not.toHaveBeenCalled(); // skip dedup when no phone
  });

  it('does not dedup when existing lead is closed (done)', async () => {
    // The SQL query filters out done/cancelled, so returns empty
    mockQueryRaw.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce({ id: 'lead-3', source: 'website', appointmentStatus: 'pending' });

    const result = await findOrCreateLeadAppointment(baseLead);

    expect(result.isDuplicate).toBe(false);
    expect(mockCreate).toHaveBeenCalledOnce();
  });
});
