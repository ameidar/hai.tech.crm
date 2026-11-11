import cron, { ScheduledTask } from 'node-cron';
import { israelToday, syncCompanyExpensesAndDrafts, syncMorningDrafts, syncCompanyExpenses } from './company-expenses.js';
import { runRecurringDetection, sendMissingRecurringReminder } from './recurring-expenses.js';

// Nightly Morning → company_expenses mirror sync (+ recurring detection), an hourly daytime
// drafts sync (uploaded invoices show before approval), and the "missing recurring invoices"
// WhatsApp reminder to Ami (weekly Sunday + 3rd of month).
const TZ = 'Asia/Jerusalem';
const DEFAULT_SYNC_CRON = '30 2 * * *';
const DEFAULT_DRAFTS_SYNC_CRON = '20 7-22 * * *';
const DEFAULT_WEEKLY_REMINDER_CRON = '0 9 * * 0';
const DEFAULT_MONTHLY_REMINDER_CRON = '0 9 3 * *';

const tasks: ScheduledTask[] = [];
let lastReminderDay: string | null = null;

const enabled = (envVar: string) => (process.env[envVar] ?? 'true').toLowerCase() !== 'false';

export async function runNightlyCompanyExpenseSync(): Promise<void> {
  try {
    const result = await syncCompanyExpensesAndDrafts();
    console.log(`[CompanyExpenses] Sync done: ${JSON.stringify({ ...result, syncedAt: result.syncedAt.toISOString() })}`);
    const detection = await runRecurringDetection();
    if (detection.created) console.log(`[CompanyExpenses] New recurring suggestions: ${detection.created}`);
  } catch (error) {
    console.error('[CompanyExpenses] Nightly sync failed:', error);
  }
}

/** Daytime drafts refresh; a full expense resync follows when drafts were approved meanwhile. */
export async function runCompanyExpenseDraftSync(): Promise<void> {
  try {
    const drafts = await syncMorningDrafts();
    if (drafts.removed > 0) await syncCompanyExpenses({ full: true });
    console.log(`[CompanyExpenses] Drafts sync done: ${JSON.stringify(drafts)}`);
  } catch (error) {
    console.error('[CompanyExpenses] Drafts sync failed:', error);
  }
}

/** Runs the reminder at most once per calendar day (Sunday the 3rd fires both crons). */
export async function runCompanyExpenseReminder(now: Date = new Date()): Promise<void> {
  const day = israelToday(now).iso;
  if (lastReminderDay === day) return;
  lastReminderDay = day;
  try {
    const result = await sendMissingRecurringReminder(now);
    console.log(`[CompanyExpenses] Reminder: ${result.sent ? `sent (${result.missing} missing)` : 'nothing missing — skipped'}`);
  } catch (error) {
    console.error('[CompanyExpenses] Reminder failed:', error);
  }
}

function schedule(name: string, expr: string, fn: () => void): void {
  if (!cron.validate(expr)) {
    console.error(`[CompanyExpenses] Invalid ${name} cron expression: ${expr}`);
    return;
  }
  tasks.push(cron.schedule(expr, fn, { timezone: TZ }));
  console.log(`[CompanyExpenses] ${name} scheduled (${expr}, ${TZ})`);
}

export function initCompanyExpensesScheduler(): void {
  tasks.splice(0).forEach((t) => t.stop());

  if (enabled('COMPANY_EXPENSES_SYNC_ENABLED')) {
    schedule('sync', process.env.COMPANY_EXPENSES_SYNC_CRON || DEFAULT_SYNC_CRON, () => { void runNightlyCompanyExpenseSync(); });
  } else {
    console.log('[CompanyExpenses] COMPANY_EXPENSES_SYNC_ENABLED=false — nightly sync disabled');
  }

  if (enabled('COMPANY_EXPENSES_DRAFTS_SYNC_ENABLED')) {
    schedule('drafts sync', process.env.COMPANY_EXPENSES_DRAFTS_SYNC_CRON || DEFAULT_DRAFTS_SYNC_CRON, () => { void runCompanyExpenseDraftSync(); });
  } else {
    console.log('[CompanyExpenses] COMPANY_EXPENSES_DRAFTS_SYNC_ENABLED=false — drafts sync disabled');
  }

  if (enabled('COMPANY_EXPENSE_REMINDERS_ENABLED')) {
    const run = () => { void runCompanyExpenseReminder(); };
    schedule('weekly reminder', process.env.COMPANY_EXPENSE_REMINDER_WEEKLY_CRON || DEFAULT_WEEKLY_REMINDER_CRON, run);
    schedule('monthly reminder', process.env.COMPANY_EXPENSE_REMINDER_MONTHLY_CRON || DEFAULT_MONTHLY_REMINDER_CRON, run);
  } else {
    console.log('[CompanyExpenses] COMPANY_EXPENSE_REMINDERS_ENABLED=false — reminders disabled');
  }
}
