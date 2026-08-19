import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import path from 'path';

const DEFAULT_HOSTS = ['ami@hai.tech', 'inna@hai.tech', 'hila@hai.tech', 'info@hai.tech'];
const DEFAULT_BUFFER_BEFORE_MINUTES = 10;
const DEFAULT_TIMEZONE = 'Asia/Jerusalem';
const DEFAULT_SEARCH_STEP_MINUTES = 15;
const DEFAULT_SEARCH_UNTIL_HOUR = 21;
const DEFAULT_ACCESS_TYPE = 'OPEN';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.settings',
];

interface GoogleServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri: string;
  client_id?: string;
}

interface GoogleMeetSpace {
  name?: string;
  meetingUri: string;
  meetingCode: string;
  config?: {
    accessType?: string;
    moderation?: string;
    entryPointAccess?: string;
    artifactConfig?: {
      recordingConfig?: { autoRecordingGeneration?: string };
      transcriptionConfig?: { autoTranscriptionGeneration?: string };
      smartNotesConfig?: { autoSmartNotesGeneration?: string };
    };
  };
}

interface CalendarEvent {
  id: string;
  htmlLink?: string;
}

export interface GoogleMeetVideoMeeting {
  provider: 'google_meet';
  id: string;
  joinUrl: string;
  startUrl?: string | null;
  password?: string | null;
  hostKey?: string | null;
  hostEmail: string;
  spaceName?: string | null;
  calendarEventId?: string | null;
  calendarEventUrl?: string | null;
  coHost?: unknown;
  events?: Array<{ meetingId?: string; calendarEventId: string; calendarEventUrl?: string | null }>;
}

interface CreateGoogleMeetParams {
  topic: string;
  lessonStart: Date;
  durationMinutes: number;
  instructorEmail?: string | null;
  record?: boolean;
  transcript?: boolean;
  smartNotes?: boolean;
}

interface CreateGoogleMeetSeriesParams {
  topic: string;
  occurrences: Array<{
    meetingId?: string;
    lessonStart: Date;
    durationMinutes: number;
  }>;
  instructorEmail?: string | null;
  record?: boolean;
  transcript?: boolean;
  smartNotes?: boolean;
}

function configuredHosts(): string[] {
  return (process.env.GOOGLE_MEET_HOSTS || DEFAULT_HOSTS.join(','))
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

function credentialsPath(): string {
  return process.env.GOOGLE_MEET_CREDENTIALS || path.resolve(process.cwd(), '../credentials/haitech-meet-automation.json');
}

function readCredentials(): GoogleServiceAccountCredentials {
  if (process.env.GOOGLE_MEET_CREDENTIALS_JSON) {
    return JSON.parse(process.env.GOOGLE_MEET_CREDENTIALS_JSON) as GoogleServiceAccountCredentials;
  }
  return JSON.parse(fs.readFileSync(credentialsPath(), 'utf8')) as GoogleServiceAccountCredentials;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(credentials: GoogleServiceAccountCredentials, subject: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: credentials.client_email,
    scope: SCOPES.join(' '),
    aud: credentials.token_uri,
    exp: nowSeconds + 3600,
    iat: nowSeconds,
    sub: subject,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(credentials.private_key);
  return `${unsigned}.${base64Url(signature)}`;
}

function requestJson<T>(url: string, options: { method?: string; headers?: Record<string, string> } = {}, body?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = {};
          if (text) {
            try {
              json = JSON.parse(text);
            } catch (error) {
              reject(new Error(`Non-JSON response ${res.statusCode}: ${text}`));
              return;
            }
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            const apiError = json as { error?: { message?: string } };
            reject(new Error(apiError.error?.message || text || `HTTP ${res.statusCode}`));
            return;
          }
          resolve(json as T);
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken(credentials: GoogleServiceAccountCredentials, subject: string): Promise<string> {
  const assertion = signJwt(credentials, subject);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }).toString();
  const response = await requestJson<{ access_token: string }>(
    credentials.token_uri,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': String(Buffer.byteLength(body)),
      },
    },
    body
  );
  return response.access_token;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function calendarStart(lessonStart: Date): Date {
  return addMinutes(lessonStart, -DEFAULT_BUFFER_BEFORE_MINUTES);
}

function lessonEnd(lessonStart: Date, durationMinutes: number): Date {
  return addMinutes(lessonStart, durationMinutes);
}

function candidateStarts(start: Date): Date[] {
  const starts: Date[] = [];
  const current = new Date(start);
  const end = new Date(start);
  end.setHours(DEFAULT_SEARCH_UNTIL_HOUR, 0, 0, 0);
  while (current <= end) {
    starts.push(new Date(current));
    current.setMinutes(current.getMinutes() + DEFAULT_SEARCH_STEP_MINUTES);
  }
  return starts;
}

async function freeBusyForHost(
  credentials: GoogleServiceAccountCredentials,
  host: string,
  start: Date,
  durationMinutes: number
): Promise<boolean> {
  const token = await getAccessToken(credentials, host);
  const response = await requestJson<{ calendars?: Record<string, { busy?: unknown[] }> }>(
    'https://www.googleapis.com/calendar/v3/freeBusy',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    JSON.stringify({
      timeMin: calendarStart(start).toISOString(),
      timeMax: lessonEnd(start, durationMinutes).toISOString(),
      timeZone: DEFAULT_TIMEZONE,
      items: [{ id: host }],
    })
  );
  return (response.calendars?.[host]?.busy || []).length === 0;
}

async function findAvailableHost(credentials: GoogleServiceAccountCredentials, requestedStart: Date, durationMinutes: number) {
  for (const start of candidateStarts(requestedStart)) {
    for (const host of configuredHosts()) {
      if (await freeBusyForHost(credentials, host, start, durationMinutes)) {
        return { host, start };
      }
    }
  }
  return null;
}

async function findAvailableHostForSeries(
  credentials: GoogleServiceAccountCredentials,
  occurrences: Array<{ lessonStart: Date; durationMinutes: number }>
): Promise<string | null> {
  for (const host of configuredHosts()) {
    let available = true;
    for (const occurrence of occurrences) {
      available = await freeBusyForHost(credentials, host, occurrence.lessonStart, occurrence.durationMinutes);
      if (!available) break;
    }
    if (available) return host;
  }
  return null;
}

async function createMeetSpace(
  credentials: GoogleServiceAccountCredentials,
  host: string,
  options: { record?: boolean; transcript?: boolean; smartNotes?: boolean }
): Promise<GoogleMeetSpace> {
  const token = await getAccessToken(credentials, host);
  return requestJson<GoogleMeetSpace>(
    'https://meet.googleapis.com/v2/spaces',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    JSON.stringify({
      config: {
        accessType: DEFAULT_ACCESS_TYPE,
        entryPointAccess: 'ALL',
        moderation: 'OFF',
        artifactConfig: {
          recordingConfig: { autoRecordingGeneration: options.record === false ? 'OFF' : 'ON' },
          transcriptionConfig: { autoTranscriptionGeneration: options.transcript === false ? 'OFF' : 'ON' },
          smartNotesConfig: { autoSmartNotesGeneration: options.smartNotes ? 'ON' : 'OFF' },
        },
      },
    })
  );
}

async function findExistingMember(token: string, space: string, instructorEmail: string) {
  const list = await requestJson<{ members?: Array<{ name?: string; email?: string }> }>(
    `https://meet.googleapis.com/v2beta/spaces/${encodeURIComponent(space)}/members`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  return (list.members || []).find((item) => item.email?.toLowerCase() === instructorEmail.toLowerCase());
}

async function recreateExistingMemberWithRole(token: string, space: string, instructorEmail: string, role: 'COHOST') {
  const member = await findExistingMember(token, space, instructorEmail);
  if (!member?.name) {
    throw new Error(`Existing member was reported but ${instructorEmail} was not found in members.list`);
  }
  await requestJson(
    `https://meet.googleapis.com/v2beta/${member.name}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  return requestJson(
    `https://meet.googleapis.com/v2beta/spaces/${encodeURIComponent(space)}/members`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    JSON.stringify({ email: instructorEmail, role })
  );
}

async function addCoHost(credentials: GoogleServiceAccountCredentials, host: string, meetingCode: string, instructorEmail?: string | null) {
  if (!instructorEmail) return null;
  const token = await getAccessToken(credentials, host);
  const candidates = Array.from(new Set([meetingCode, meetingCode.replace(/-/g, '')]));

  try {
    const space = await requestJson<{ name?: string }>(
      `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(meetingCode)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (space.name?.startsWith('spaces/')) {
      candidates.unshift(space.name.slice('spaces/'.length));
    }
  } catch (error) {
    console.warn(`[Google Meet] Could not look up space ${meetingCode}:`, error);
  }

  const failures: Array<{ space: string; reason: string }> = [];
  for (const space of candidates) {
    try {
      return await requestJson(
        `https://meet.googleapis.com/v2beta/spaces/${encodeURIComponent(space)}/members`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
        JSON.stringify({ email: instructorEmail, role: 'COHOST' })
      );
    } catch (error: any) {
      if (error.message === 'Member already exists.') {
        return recreateExistingMemberWithRole(token, space, instructorEmail, 'COHOST');
      }
      failures.push({ space, reason: error.message });
    }
  }

  return { ok: false, failures };
}

function assertCoHostAdded(coHost: unknown, instructorEmail?: string | null) {
  if (!instructorEmail) return;
  if ((coHost as { ok?: boolean } | null)?.ok === false) {
    const failures = (coHost as { failures?: Array<{ space: string; reason: string }> }).failures || [];
    const reasons = failures.map((failure) => `${failure.space}: ${failure.reason}`).join('; ');
    throw new Error(`Failed to add ${instructorEmail} as Google Meet co-host${reasons ? ` (${reasons})` : ''}`);
  }
}

async function createCalendarEvent(
  credentials: GoogleServiceAccountCredentials,
  host: string,
  params: {
    topic: string;
    lessonStart: Date;
    durationMinutes: number;
    meetLink: string;
  }
): Promise<CalendarEvent> {
  const token = await getAccessToken(credentials, host);
  return requestJson<CalendarEvent>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(host)}/events?sendUpdates=none`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    JSON.stringify({
      summary: params.topic,
      location: params.meetLink,
      description: `נוצר אוטומטית על ידי CRM דרך ההייטק.\n\nפתיחת חדר: ${DEFAULT_BUFFER_BEFORE_MINUTES} דקות לפני תחילת השיעור.\nGoogle Meet: ${params.meetLink}`,
      start: { dateTime: calendarStart(params.lessonStart).toISOString(), timeZone: DEFAULT_TIMEZONE },
      end: { dateTime: lessonEnd(params.lessonStart, params.durationMinutes).toISOString(), timeZone: DEFAULT_TIMEZONE },
    })
  );
}

export async function createMeeting(params: CreateGoogleMeetParams): Promise<GoogleMeetVideoMeeting | null> {
  const credentials = readCredentials();
  const availability = await findAvailableHost(credentials, params.lessonStart, params.durationMinutes);
  if (!availability) return null;
  const space = await createMeetSpace(credentials, availability.host, params);
  const coHost = await addCoHost(credentials, availability.host, space.meetingCode, params.instructorEmail);
  assertCoHostAdded(coHost, params.instructorEmail);
  const event = await createCalendarEvent(credentials, availability.host, {
    topic: params.topic,
    lessonStart: availability.start,
    durationMinutes: params.durationMinutes,
    meetLink: space.meetingUri,
  });
  return {
    provider: 'google_meet',
    id: space.meetingCode,
    joinUrl: space.meetingUri,
    startUrl: event.htmlLink || null,
    hostEmail: availability.host,
    spaceName: space.name || null,
    calendarEventId: event.id,
    calendarEventUrl: event.htmlLink || null,
    coHost,
  };
}

export async function createCycleMeeting(params: CreateGoogleMeetSeriesParams): Promise<GoogleMeetVideoMeeting | null> {
  const credentials = readCredentials();
  const host = await findAvailableHostForSeries(credentials, params.occurrences);
  if (!host) return null;
  const space = await createMeetSpace(credentials, host, params);
  const coHost = await addCoHost(credentials, host, space.meetingCode, params.instructorEmail);
  assertCoHostAdded(coHost, params.instructorEmail);
  const events = [];
  for (const occurrence of params.occurrences) {
    const event = await createCalendarEvent(credentials, host, {
      topic: params.topic,
      lessonStart: occurrence.lessonStart,
      durationMinutes: occurrence.durationMinutes,
      meetLink: space.meetingUri,
    });
    events.push({
      meetingId: occurrence.meetingId,
      calendarEventId: event.id,
      calendarEventUrl: event.htmlLink || null,
    });
  }
  return {
    provider: 'google_meet',
    id: space.meetingCode,
    joinUrl: space.meetingUri,
    hostEmail: host,
    spaceName: space.name || null,
    calendarEventId: events[0]?.calendarEventId || null,
    calendarEventUrl: events[0]?.calendarEventUrl || null,
    coHost,
    events,
  };
}

export const googleMeetService = {
  createMeeting,
  createCycleMeeting,
};
