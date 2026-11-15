import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../morning/client.js', () => ({ isMorningConfigured: vi.fn(() => true) }));
vi.mock('../morning/documents.js', () => ({ searchMorningDocuments: vi.fn() }));
vi.mock('../morning-credit-notes.js', () => ({
  CREDIT_NOTE_DOC_TYPE: 330,
  applyMorningCreditNote: vi.fn(),
}));

import { searchMorningDocuments } from '../morning/documents.js';
import { applyMorningCreditNote } from '../morning-credit-notes.js';
import { syncRecentMorningCreditNotes } from '../morning-credit-sync-scheduler.js';

const mockSearch = vi.mocked(searchMorningDocuments);
const mockApply = vi.mocked(applyMorningCreditNote);

const doc = (n: number) => ({ id: `c-${n}`, number: n, type: 330, documentDate: '2026-11-10', status: 0 });

describe('syncRecentMorningCreditNotes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pages through 330 documents of the last 14 days and applies each', async () => {
    mockSearch
      .mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, i) => doc(i)), total: 130 } as any)
      .mockResolvedValueOnce({ items: Array.from({ length: 30 }, (_, i) => doc(100 + i)), total: 130 } as any);
    mockApply.mockImplementation(async (d: any) => ({
      outcome: d.number === 0 ? 'refunded' : 'already',
      paymentIds: [],
      registrationIds: [],
      billingMatches: [],
    }));

    const result = await syncRecentMorningCreditNotes(14, { now: new Date('2026-11-15T01:00:00Z') });

    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(mockSearch).toHaveBeenNthCalledWith(1, {
      type: [330], fromDate: '2026-11-01', toDate: '2026-11-15', page: 1, pageSize: 100,
    });
    expect(mockSearch.mock.calls[1][0]).toEqual(expect.objectContaining({ page: 2 }));
    expect(mockApply).toHaveBeenCalledTimes(130);
    expect(result.total).toBe(130);
    expect(result.counts).toEqual({ refunded: 1, already: 129 });
  });

  it('keeps going when one credit note fails', async () => {
    mockSearch.mockResolvedValueOnce({ items: [doc(1), doc(2)], total: 2 } as any);
    mockApply
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ outcome: 'not_found', paymentIds: [], registrationIds: [], billingMatches: [] });

    const result = await syncRecentMorningCreditNotes();

    expect(result.counts).toEqual({ error: 1, not_found: 1 });
  });
});
