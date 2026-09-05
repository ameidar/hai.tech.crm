import OpenAI from 'openai';
import { prisma } from '../utils/prisma.js';

const DEFAULT_REGION = 'ap-northeast-1';
const DEFAULT_BOT_NAME = 'HaiTech Lesson Bot';
const DEFAULT_JOIN_EARLY_MINUTES = 2;

type RecallRegion = 'us-east-1' | 'us-west-2' | 'eu-central-1' | 'ap-northeast-1';

interface RecallBotResponse {
  id: string;
  bot_name?: string;
  join_at?: string;
  meeting_url?: unknown;
  status_changes?: Array<{ code: string; sub_code?: string | null; created_at: string; message?: string | null }>;
  recordings?: RecallRecording[];
  metadata?: Record<string, unknown>;
}

interface RecallRecording {
  id: string;
  started_at?: string;
  completed_at?: string;
  media_shortcuts?: {
    video_mixed?: { data?: { download_url?: string } };
    transcript?: { data?: { download_url?: string; provider_data_download_url?: string } };
  };
}

interface ScheduleBotOptions {
  meetingId: string;
  joinEarlyMinutes?: number;
}

function recallApiKey() {
  const key = process.env.RECALL_API_KEY?.trim();
  if (!key) throw new Error('RECALL_API_KEY is not configured');
  return key;
}

function recallRegion(): RecallRegion {
  return (process.env.RECALL_REGION || DEFAULT_REGION) as RecallRegion;
}

function recallBaseUrl() {
  return `https://${recallRegion()}.recall.ai/api/v1`;
}

function openaiClient() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('OPENAI_API_KEY is not configured');
  return new OpenAI({ apiKey: key });
}

async function recallRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${recallBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${recallApiKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = body?.detail || body?.error || body?.message || `Recall API failed (${response.status})`;
    throw new Error(message);
  }

  return body as T;
}

function israelOffsetForDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const value = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT+2';
  const match = value.match(/GMT([+-])(\d+)/);
  return match ? `${match[1]}${match[2].padStart(2, '0')}:00` : '+02:00';
}

function dateTimeFromMeeting(scheduledDate: Date, startTime: Date, joinEarlyMinutes: number) {
  const date = scheduledDate.toISOString().slice(0, 10);
  const hours = String(startTime.getUTCHours()).padStart(2, '0');
  const minutes = String(startTime.getUTCMinutes()).padStart(2, '0');
  const lessonStart = new Date(`${date}T${hours}:${minutes}:00${israelOffsetForDate(scheduledDate)}`);
  return new Date(lessonStart.getTime() - joinEarlyMinutes * 60_000);
}

function latestStatus(bot: RecallBotResponse) {
  return bot.status_changes?.at(-1)?.code || null;
}

async function downloadJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Recall transcript (${response.status})`);
  }
  return response.json();
}

function transcriptToText(payload: unknown): string {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.segments)
      ? (payload as any).segments
      : Array.isArray((payload as any)?.transcript)
        ? (payload as any).transcript
        : [];

  return items
    .map((item: any) => {
      const speaker = item.speaker || item.speaker_name || item.participant?.name || 'דובר';
      const text = Array.isArray(item.words)
        ? item.words.map((word: any) => word.text || word.word || '').join(' ')
        : item.text || item.transcript || '';
      return text.trim() ? `${speaker}: ${text.trim()}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

async function generateLessonReport(params: {
  transcript: string;
  cycleName?: string | null;
  courseName?: string | null;
  instructorName?: string | null;
  scheduledDate?: Date | null;
}) {
  const openai = openaiClient();
  const response = await openai.chat.completions.create({
    model: process.env.LESSON_REPORT_MODEL || 'gpt-4o',
    temperature: 0.2,
    max_tokens: 1400,
    messages: [
      {
        role: 'system',
        content: `אתה מסכם שיעורי תכנות לילדים עבור מנהל תפעול של דרך ההייטק.
כתוב בעברית, קצר וברור, עם דגש על מה קרה בפועל בשיעור ולא על ניסוח שיווקי.

פורמט:
סיכום קצר:
- ...

מה נלמד/תורגל:
- ...

פעולות המדריך:
- ...

מצב התלמיד:
- ...

משימות/המשך:
- ...

חריגים לתשומת לב:
- ...`,
      },
      {
        role: 'user',
        content: [
          `מחזור: ${params.cycleName || '-'}`,
          `קורס: ${params.courseName || '-'}`,
          `מדריך: ${params.instructorName || '-'}`,
          `תאריך: ${params.scheduledDate?.toISOString().slice(0, 10) || '-'}`,
          '',
          'תמלול:',
          params.transcript,
        ].join('\n'),
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() || '';
}

export async function scheduleRecallBotForMeeting(options: ScheduleBotOptions) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: options.meetingId },
    include: {
      cycle: { include: { course: true } },
      instructor: true,
    },
  });

  if (!meeting) throw new Error('Meeting not found');
  if (!meeting.zoomJoinUrl) throw new Error('Meeting has no video link');

  const joinAt = dateTimeFromMeeting(
    meeting.scheduledDate,
    meeting.startTime,
    options.joinEarlyMinutes ?? DEFAULT_JOIN_EARLY_MINUTES
  );
  const bot = await recallRequest<RecallBotResponse>('/bot', {
    method: 'POST',
    body: JSON.stringify({
      join_at: joinAt.toISOString(),
      meeting_url: meeting.zoomJoinUrl,
      bot_name: process.env.RECALL_BOT_NAME || DEFAULT_BOT_NAME,
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {
              language_code: 'auto',
              mode: 'prioritize_accuracy',
            },
          },
        },
      },
      metadata: {
        source: 'haitech-crm',
        meetingId: meeting.id,
        cycleId: meeting.cycleId,
      },
    }),
  });

  await prisma.meeting.update({
    where: { id: meeting.id },
    data: {
      recallBotId: bot.id,
      recallBotStatus: latestStatus(bot) || 'scheduled',
      lessonReportStatus: 'scheduled',
      lessonReportError: null,
    },
  });

  return bot;
}

export async function processRecallBot(botId: string) {
  const bot = await recallRequest<RecallBotResponse>(`/bot/${encodeURIComponent(botId)}/`);
  const meetingId = typeof bot.metadata?.meetingId === 'string'
    ? bot.metadata.meetingId
    : null;
  const meeting = await prisma.meeting.findFirst({
    where: meetingId ? { id: meetingId } : { recallBotId: bot.id },
    include: {
      cycle: { include: { course: true } },
      instructor: true,
    },
  });

  if (!meeting) throw new Error('No CRM meeting matched this Recall bot');

  try {
    const recording = bot.recordings?.[0];
    const transcriptUrl = recording?.media_shortcuts?.transcript?.data?.download_url;
    const videoUrl = recording?.media_shortcuts?.video_mixed?.data?.download_url;
    if (!recording || !transcriptUrl) {
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: {
          recallBotStatus: latestStatus(bot),
          lessonReportStatus: latestStatus(bot) === 'done' ? 'missing_transcript' : 'processing',
        },
      });
      return { meeting, bot, processed: false };
    }

    const transcriptPayload = await downloadJson(transcriptUrl);
    const transcript = transcriptToText(transcriptPayload);
    if (!transcript) throw new Error('Recall transcript was empty');

    const summary = await generateLessonReport({
      transcript,
      cycleName: meeting.cycle?.name,
      courseName: meeting.cycle?.course?.name,
      instructorName: meeting.instructor?.name,
      scheduledDate: meeting.scheduledDate,
    });

    const updatedMeeting = await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        recallBotStatus: latestStatus(bot) || 'done',
        recallRecordingId: recording.id,
        recallRecordingUrl: videoUrl || null,
        recallTranscriptUrl: transcriptUrl,
        lessonTranscript: transcript,
        lessonSummary: summary,
        lessonReportStatus: 'ready',
        lessonReportGeneratedAt: new Date(),
        lessonReportError: null,
      },
    });

    return { meeting: updatedMeeting, bot, processed: true };
  } catch (error: any) {
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        recallBotStatus: latestStatus(bot),
        lessonReportStatus: 'failed',
        lessonReportError: error.message || 'Recall processing failed',
      },
    });
    throw error;
  }
}

export const recallAiService = {
  processRecallBot,
  scheduleRecallBotForMeeting,
};
