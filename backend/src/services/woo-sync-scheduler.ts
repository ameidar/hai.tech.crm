import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config.js';
import { syncRecentWooPayments } from './woo-sync.js';

let scheduledTask: ScheduledTask | null = null;
let running = false;

const DEFAULT_CRON = '*/10 * * * *';
const TZ = 'Asia/Jerusalem';

async function runWooBackupSync(): Promise<void> {
  if (running) {
    console.log('[WooSync] Previous backup sync still running; skipping this tick');
    return;
  }

  if (!config.woo.siteUrl || !config.woo.consumerKey || !config.woo.consumerSecret) {
    console.log('[WooSync] Missing WooCommerce credentials; backup sync skipped');
    return;
  }

  running = true;
  try {
    const days = Number(process.env.WOO_BACKUP_SYNC_DAYS || '1');
    const result = await syncRecentWooPayments(days);
    console.log(
      `[WooSync] Backup sync done: created=${result.created}, updated=${result.updated}, skipped=${result.skipped}, failed=${result.failed}, total=${result.total}, days=${result.days}`
    );
  } catch (error) {
    console.error('[WooSync] Backup sync failed:', error);
  } finally {
    running = false;
  }
}

export function initWooBackupSyncScheduler(): void {
  if (process.env.WOO_BACKUP_SYNC_DISABLED === 'true') {
    console.log('[WooSync] WOO_BACKUP_SYNC_DISABLED=true — scheduler disabled');
    return;
  }

  scheduledTask?.stop();
  const schedule = process.env.WOO_BACKUP_SYNC_CRON || DEFAULT_CRON;
  scheduledTask = cron.schedule(schedule, () => {
    runWooBackupSync();
  }, { timezone: TZ });

  console.log(`[WooSync] Scheduler initialized (${schedule}, ${TZ})`);
}

export function stopWooBackupSyncScheduler(): void {
  scheduledTask?.stop();
  scheduledTask = null;
  running = false;
  console.log('[WooSync] Scheduler stopped');
}

export const triggerWooBackupSync = () => runWooBackupSync();
