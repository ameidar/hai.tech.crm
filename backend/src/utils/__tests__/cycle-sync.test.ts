import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCycleFindUnique = vi.fn();
const mockCycleUpdate = vi.fn();
const mockMeetingCount = vi.fn();

vi.mock('../prisma.js', () => ({
  prisma: {
    cycle: {
      findUnique: mockCycleFindUnique,
      update: mockCycleUpdate,
    },
    meeting: {
      count: mockMeetingCount,
    },
  },
}));

const {
  INTERNAL_OPERATIONS_CYCLE_NAME,
  shouldAutoCompleteCycle,
  syncCycleProgress,
} = await import('../cycle-sync.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cycle sync', () => {
  it('never auto-completes the internal operations cycle', async () => {
    mockCycleFindUnique.mockResolvedValueOnce({ name: INTERNAL_OPERATIONS_CYCLE_NAME });

    await expect(shouldAutoCompleteCycle('internal-cycle')).resolves.toBe(false);
    expect(mockMeetingCount).not.toHaveBeenCalled();
  });

  it('allows regular cycles to use the existing remaining-meetings completion rule', async () => {
    mockCycleFindUnique.mockResolvedValueOnce({ name: 'רובלוקס מתחילים' });

    await expect(shouldAutoCompleteCycle('regular-cycle')).resolves.toBe(true);
    expect(mockMeetingCount).not.toHaveBeenCalled();
  });

  it('uses open operational meetings as remaining count for active internal operations cycles', async () => {
    mockCycleFindUnique.mockResolvedValueOnce({
      name: INTERNAL_OPERATIONS_CYCLE_NAME,
      status: 'active',
      totalMeetings: 0,
    });
    mockMeetingCount
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1);
    mockCycleUpdate.mockResolvedValueOnce({});

    await expect(syncCycleProgress('internal-cycle')).resolves.toEqual({
      completedMeetings: 4,
      remainingMeetings: 1,
    });
    expect(mockCycleUpdate).toHaveBeenCalledWith({
      where: { id: 'internal-cycle' },
      data: { completedMeetings: 4, remainingMeetings: 1 },
    });
  });
});
