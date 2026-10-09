import cron, { ScheduledTask } from 'node-cron';
import { syncRecentMorningReceipts } from './morning-receipt-sync.js';

let scheduledTask: ScheduledTask | null = null;
let running = false;

const DEFAULT_CRON = '*/15 * * * *';
const TZ = 'Asia/Jerusalem';

async function runMorningReceiptSync(): Promise<void> {
  if (running) {
    console.log('[MorningReceiptSync] Previous run still in progress; skipping this tick');
    return;
  }

  running = true;
  try {
    const days = Number(process.env.MORNING_RECEIPT_SYNC_DAYS || '2');
    const result = await syncRecentMorningReceipts(days);
    if (result.counts.created) {
      console.log(`[MorningReceiptSync] Done: total=${result.total}, counts=${JSON.stringify(result.counts)}`);
    }
  } catch (error) {
    console.error('[MorningReceiptSync] Sync failed:', error);
  } finally {
    running = false;
  }
}

export function initMorningReceiptSyncScheduler(): void {
  if (process.env.MORNING_RECEIPT_SYNC_DISABLED === 'true') {
    console.log('[MorningReceiptSync] MORNING_RECEIPT_SYNC_DISABLED=true — scheduler disabled');
    return;
  }

  const expr = process.env.MORNING_RECEIPT_SYNC_CRON || DEFAULT_CRON;
  if (!cron.validate(expr)) {
    console.error(`[MorningReceiptSync] Invalid cron expression: ${expr}`);
    return;
  }

  scheduledTask?.stop();
  scheduledTask = cron.schedule(expr, () => { void runMorningReceiptSync(); }, { timezone: TZ });
  console.log(`[MorningReceiptSync] Scheduler initialized (${expr}, ${TZ})`);
}
