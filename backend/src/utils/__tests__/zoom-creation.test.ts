import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../prisma.js', () => ({ prisma: {} }));

import {
  ZOOM_CREATION_DISABLED_MESSAGE,
  isAllowedNewVideoProvider,
  isZoomCreationEnabled,
  legacyVideoProviderForGeneratedMeetings,
} from '../zoom-creation.js';
import { createCycleMeeting, createMeeting, resolveNewVideoProvider } from '../../services/zoom.js';
import { createMeetingSchema as v1CreateMeetingSchema } from '../../api/v1/validators/meetings.js';
import { createMeetingSchema } from '../../types/schemas.js';

const ORIGINAL = process.env.ZOOM_CREATION_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ZOOM_CREATION_ENABLED;
  else process.env.ZOOM_CREATION_ENABLED = ORIGINAL;
});

describe('Zoom creation kill-switch', () => {
  it('is disabled by default and only enabled by an explicit "true"', () => {
    delete process.env.ZOOM_CREATION_ENABLED;
    expect(isZoomCreationEnabled()).toBe(false);
    process.env.ZOOM_CREATION_ENABLED = 'false';
    expect(isZoomCreationEnabled()).toBe(false);
    process.env.ZOOM_CREATION_ENABLED = 'TRUE';
    expect(isZoomCreationEnabled()).toBe(true);
  });

  it('resolves new providers to Google Meet and rejects explicit zoom with 400', () => {
    delete process.env.ZOOM_CREATION_ENABLED;
    expect(resolveNewVideoProvider(undefined)).toBe('google_meet');
    expect(resolveNewVideoProvider('google_meet')).toBe('google_meet');
    expect(() => resolveNewVideoProvider('zoom')).toThrowError(ZOOM_CREATION_DISABLED_MESSAGE);
    try {
      resolveNewVideoProvider('zoom');
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
    }
    expect(isAllowedNewVideoProvider('zoom')).toBe(false);

    process.env.ZOOM_CREATION_ENABLED = 'true';
    expect(resolveNewVideoProvider('zoom')).toBe('zoom');
  });

  it('blocks the Zoom service create functions before any API call', async () => {
    delete process.env.ZOOM_CREATION_ENABLED;
    await expect(
      createMeeting('host', { topic: 't', startTime: new Date(), duration: 30 }),
    ).rejects.toMatchObject({ statusCode: 400, message: ZOOM_CREATION_DISABLED_MESSAGE });
    await expect(
      createCycleMeeting({
        cycleName: 'c',
        startDate: new Date(),
        endDate: new Date(),
        dayOfWeek: 1,
        startTime: '10:00',
        durationMinutes: 60,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('validators default to google_meet and reject zoom', () => {
    delete process.env.ZOOM_CREATION_ENABLED;
    const base = {
      cycleId: '11111111-1111-4111-8111-111111111111',
      instructorId: '11111111-1111-4111-8111-111111111111',
      scheduledDate: '2026-11-15',
      startTime: '10:00',
      endTime: '11:00',
    };
    expect(v1CreateMeetingSchema.parse(base).videoProvider).toBe('google_meet');
    expect(v1CreateMeetingSchema.safeParse({ ...base, videoProvider: 'zoom' }).success).toBe(false);
    expect(createMeetingSchema.parse(base).videoProvider).toBe('google_meet');
    expect(createMeetingSchema.safeParse({ ...base, videoProvider: 'zoom' }).success).toBe(false);
  });

  it('generated meetings keep zoom only for cycles with an existing Zoom series', () => {
    expect(legacyVideoProviderForGeneratedMeetings({ videoProvider: 'zoom', zoomMeetingId: '123' })).toBe('zoom');
    expect(legacyVideoProviderForGeneratedMeetings({ videoProvider: 'zoom', zoomMeetingId: null })).toBe('google_meet');
    expect(legacyVideoProviderForGeneratedMeetings({ videoProvider: 'google_meet', zoomMeetingId: 'abc' })).toBe('google_meet');
  });
});
