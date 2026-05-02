import cron from 'node-cron';
import { generateAllBillingPeriodsForMonth } from './billing.js';

/**
 * On the 1st of each month at 02:00 (Asia/Jerusalem implicit via host TZ),
 * generate draft billing periods for the previous month for every active
 * institutional order. Drafts are NEVER auto-issued — an admin must
 * approve and issue from the UI.
 */
export function initBillingScheduler() {
  cron.schedule('0 2 1 * *', async () => {
    const today = new Date();
    // Previous month
    const y = today.getUTCMonth() === 0 ? today.getUTCFullYear() - 1 : today.getUTCFullYear();
    const m = today.getUTCMonth() === 0 ? 12 : today.getUTCMonth();
    const month = `${y}-${String(m).padStart(2, '0')}`;
    console.log(`[BILLING] Auto-generating drafts for ${month}...`);
    try {
      const result = await generateAllBillingPeriodsForMonth(month);
      console.log(`[BILLING] Done — created=${result.created}, skipped=${result.skipped}, empty=${result.empty}, errors=${result.errors.length}`);
      if (result.errors.length) console.warn('[BILLING] errors:', result.errors);
    } catch (e) {
      console.error('[BILLING] Scheduler error:', e);
    }
  });
  console.log('[BILLING] Scheduler initialized (1st of month, 02:00) — drafts only, manual approval to issue');
}
