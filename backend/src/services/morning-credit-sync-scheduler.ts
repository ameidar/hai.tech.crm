import cron, { ScheduledTask } from 'node-cron';
import { isMorningConfigured } from './morning/client.js';
import { searchMorningDocuments } from './morning/documents.js';
import { applyMorningCreditNote, CREDIT_NOTE_DOC_TYPE, type CreditNoteOutcome } from './morning-credit-notes.js';

/**
 * Nightly safety net for the Morning webhook: re-applies every credit note (330) issued in
 * the last N days. applyMorningCreditNote is idempotent, so already-handled notes are no-ops.
 */
const DEFAULT_CRON = '40 2 * * *';
const TZ = 'Asia/Jerusalem';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
export const DEFAULT_CREDIT_SYNC_DAYS = 14;

let scheduledTask: ScheduledTask | null = null;
let running = false;

export interface CreditSyncResult {
  total: number;
  counts: Partial<Record<CreditNoteOutcome | 'error', number>>;
  billingMatches: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function syncRecentMorningCreditNotes(
  days = DEFAULT_CREDIT_SYNC_DAYS,
  opts: { now?: Date } = {},
): Promise<CreditSyncResult> {
  const result: CreditSyncResult = { total: 0, counts: {}, billingMatches: 0 };
  if (!isMorningConfigured()) {
    console.log('[MorningCreditSync] Morning API not configured; skipped');
    return result;
  }

  const now = opts.now ?? new Date();
  const fromDate = isoDate(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
  const toDate = isoDate(now);

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { items } = await searchMorningDocuments({
      type: [CREDIT_NOTE_DOC_TYPE],
      fromDate,
      toDate,
      page,
      pageSize: PAGE_SIZE,
    });

    for (const doc of items || []) {
      result.total++;
      try {
        const applied = await applyMorningCreditNote(doc as any);
        result.counts[applied.outcome] = (result.counts[applied.outcome] || 0) + 1;
        result.billingMatches += applied.billingMatches.length;
      } catch (err) {
        result.counts.error = (result.counts.error || 0) + 1;
        console.error(`[MorningCreditSync] credit #${doc.number} failed:`, err);
      }
    }

    if (!items || items.length < PAGE_SIZE) break;
  }

  return result;
}

export async function runMorningCreditSync(): Promise<void> {
  if (running) {
    console.log('[MorningCreditSync] Previous run still in progress; skipping this tick');
    return;
  }
  running = true;
  try {
    const days = Number(process.env.MORNING_CREDIT_SYNC_DAYS || DEFAULT_CREDIT_SYNC_DAYS);
    const result = await syncRecentMorningCreditNotes(days);
    console.log(`[MorningCreditSync] Done: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error('[MorningCreditSync] Sync failed:', error);
  } finally {
    running = false;
  }
}

export function initMorningCreditSyncScheduler(): void {
  if ((process.env.MORNING_CREDIT_SYNC_ENABLED ?? 'true').toLowerCase() === 'false') {
    console.log('[MorningCreditSync] MORNING_CREDIT_SYNC_ENABLED=false — scheduler disabled');
    return;
  }

  const expr = process.env.MORNING_CREDIT_SYNC_CRON || DEFAULT_CRON;
  if (!cron.validate(expr)) {
    console.error(`[MorningCreditSync] Invalid cron expression: ${expr}`);
    return;
  }

  scheduledTask?.stop();
  scheduledTask = cron.schedule(expr, () => { void runMorningCreditSync(); }, { timezone: TZ });
  console.log(`[MorningCreditSync] Scheduler initialized (${expr}, ${TZ})`);
}
