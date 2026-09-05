import cron, { ScheduledTask } from 'node-cron';
import { googleMeetService } from './google-meet.js';

const TZ = 'Asia/Jerusalem';
const DEFAULT_SCHEDULE = '*/30 * * * *';

let scheduledTask: ScheduledTask | null = null;
let isRunning = false;

export function initGoogleMeetArtifactsScheduler() {
  if (process.env.GOOGLE_MEET_ARTIFACT_SYNC_DISABLED === 'true') {
    console.log('[GoogleMeetArtifacts] Scheduler disabled');
    return;
  }

  const schedule = process.env.GOOGLE_MEET_ARTIFACT_SYNC_CRON || DEFAULT_SCHEDULE;

  scheduledTask?.stop();
  scheduledTask = cron.schedule(schedule, async () => {
    if (isRunning) {
      console.log('[GoogleMeetArtifacts] Previous sync still running, skipping');
      return;
    }

    isRunning = true;
    try {
      const result = await googleMeetService.syncArtifactsForRecentMeetings();
      console.log(
        `[GoogleMeetArtifacts] Sync done: candidates=${result.candidates}, checked=${result.checked}, ` +
        `updated=${result.updated}, missingArtifactAlerts=${result.missingArtifactAlerts}, ` +
        `skippedNotReady=${result.skippedNotReady}, failed=${result.failed}`
      );
    } catch (error) {
      console.error('[GoogleMeetArtifacts] Sync failed:', error);
    } finally {
      isRunning = false;
    }
  }, { timezone: TZ });

  console.log(`[GoogleMeetArtifacts] Scheduler initialized (${schedule}, ${TZ})`);
}

export function stopGoogleMeetArtifactsScheduler() {
  scheduledTask?.stop();
  scheduledTask = null;
}
