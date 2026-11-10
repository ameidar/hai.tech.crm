/**
 * Zoom meeting CREATION kill-switch (dependency-free so validators can use it).
 *
 * Owner decision 2026-11-10: the Zoom subscription is cancelled at the next
 * renewal (14.1.2027) — from now on only Google Meet links may be created.
 * Reading / deleting existing Zoom meetings and recordings keeps working
 * (needed for migration and cleanup).
 *
 * ZOOM_CREATION_ENABLED=true re-enables Zoom creation (emergency escape hatch
 * only). Default: disabled.
 */
export const ZOOM_CREATION_DISABLED_MESSAGE = 'יצירת פגישות Zoom הושבתה – השתמשו ב-Google Meet';
export const ZOOM_CREATION_DISABLED_CODE = 'ZOOM_CREATION_DISABLED';

export function isZoomCreationEnabled(): boolean {
  return String(process.env.ZOOM_CREATION_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/**
 * videoProvider for meetings generated into an existing cycle: 'zoom' only when
 * the cycle already carries a legacy Zoom series link, otherwise Google Meet.
 * (Labels only — no Zoom meeting is created.)
 */
export function legacyVideoProviderForGeneratedMeetings(cycle: {
  videoProvider?: string | null;
  zoomMeetingId?: string | null;
}): 'zoom' | 'google_meet' {
  return (cycle.videoProvider ?? 'zoom') === 'zoom' && cycle.zoomMeetingId ? 'zoom' : 'google_meet';
}

/** zod refine predicate: provider value is allowed for a NEW meeting/cycle. */
export function isAllowedNewVideoProvider(provider: string | null | undefined): boolean {
  return provider !== 'zoom' || isZoomCreationEnabled();
}
