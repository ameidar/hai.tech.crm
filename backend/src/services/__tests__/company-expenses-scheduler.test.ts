import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = { draftRunning: false, syncRunning: false };

vi.mock('../company-expenses.js', () => ({
  isCompanyExpenseDraftSyncRunning: vi.fn(() => state.draftRunning),
  isCompanyExpenseSyncRunning: vi.fn(() => state.syncRunning),
  israelToday: vi.fn(() => ({ iso: '2026-11-10' })),
  syncCompanyExpensesAndDrafts: vi.fn(),
  syncMorningDrafts: vi.fn(async () => ({ fetched: 1, upserted: 1, removed: 0, missingRates: 0 })),
  syncCompanyExpenses: vi.fn(),
}));

vi.mock('../recurring-expenses.js', () => ({
  runRecurringDetection: vi.fn(),
  sendMissingRecurringReminder: vi.fn(),
  sendDraftsApprovalReminder: vi.fn(async () => { throw new Error('boom'); }),
}));

import { syncMorningDrafts } from '../company-expenses.js';
import { runDraftsApprovalReminder, scheduleDraftSyncAfterUpload } from '../company-expenses-scheduler.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.draftRunning = false;
  state.syncRunning = false;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe('scheduleDraftSyncAfterUpload', () => {
  it('runs one drafts sync after the delay, debouncing repeated uploads', async () => {
    scheduleDraftSyncAfterUpload(45_000);
    await vi.advanceTimersByTimeAsync(30_000);
    scheduleDraftSyncAfterUpload(45_000); // second upload resets the timer
    await vi.advanceTimersByTimeAsync(30_000);
    expect(syncMorningDrafts).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(syncMorningDrafts).toHaveBeenCalledTimes(1);
  });

  it('waits and retries while another sync is running', async () => {
    state.draftRunning = true;
    scheduleDraftSyncAfterUpload(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(syncMorningDrafts).not.toHaveBeenCalled();
    state.draftRunning = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(syncMorningDrafts).toHaveBeenCalledTimes(1);
  });
});

it('drafts reminder never throws', async () => {
  await expect(runDraftsApprovalReminder()).resolves.toBeUndefined();
});
