import type { Cycle, Meeting } from '../types';

interface ExportCycle {
  name: string;
  meetings: Meeting[];
}

export interface MeetingsExportFilter {
  month?: string;
}

export const normalizeExportMonth = (value: string | null): string | null => {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return 'invalid';
  const month = Number(trimmed.slice(5, 7));
  if (month < 1 || month > 12) return 'invalid';
  return trimmed;
};

const sanitizeFileName = (value: string): string =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 90) || 'meetings';

const formatDate = (dateStr: string): string => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('he-IL', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const formatTime = (time: string): string => {
  if (!time) return '';
  if (time.includes('T')) {
    const date = new Date(time);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  return time.substring(0, 5);
};

const timeToMinutes = (time: string): number | null => {
  const formatted = formatTime(time);
  const [hours, minutes] = formatted.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const formatDuration = (meeting: Meeting): string => {
  const start = timeToMinutes(meeting.startTime);
  const end = timeToMinutes(meeting.endTime);
  if (start === null || end === null) return '';
  const duration = end >= start ? end - start : end + 24 * 60 - start;
  return `${duration} דקות`;
};

const exportStatus = (meeting: Meeting): string => {
  switch (meeting.status) {
    case 'completed':
      return 'התקיים';
    case 'postponed':
    case 'pending_postponement':
      return 'נדחה';
    case 'cancelled':
    case 'pending_cancellation':
      return 'בוטל';
    default:
      return '';
  }
};

const csvEscape = (value: unknown): string => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

const filterMeetings = (meetings: Meeting[], filter?: MeetingsExportFilter): Meeting[] => {
  if (!filter?.month) return meetings;
  return meetings.filter((meeting) => meeting.scheduledDate?.slice(0, 7) === filter.month);
};

export const buildMeetingsCsv = (cycles: ExportCycle[], includeCycleName: boolean, filter?: MeetingsExportFilter): string => {
  const headers = [
    ...(includeCycleName ? ['שם המחזור'] : []),
    'תאריך',
    'שעה',
    'משך המפגש',
    'סטטוס',
  ];

  const rows = cycles.flatMap((cycle) =>
    filterMeetings(cycle.meetings, filter)
      .sort((a, b) => `${a.scheduledDate}${a.startTime}`.localeCompare(`${b.scheduledDate}${b.startTime}`))
      .map((meeting) => [
        ...(includeCycleName ? [cycle.name] : []),
        formatDate(meeting.scheduledDate),
        `${formatTime(meeting.startTime)} - ${formatTime(meeting.endTime)}`,
        formatDuration(meeting),
        exportStatus(meeting),
      ])
  );

  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
};

export function exportMeetingsToExcel(cycles: ExportCycle[], filename: string, includeCycleName = cycles.length > 1, filter?: MeetingsExportFilter) {
  const csv = buildMeetingsCsv(cycles, includeCycleName, filter);
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitizeFileName(filename)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportCycleMeetingsToExcel(cycle: Cycle, meetings: Meeting[], filter?: MeetingsExportFilter) {
  const suffix = filter?.month ? ` - ${filter.month}` : '';
  exportMeetingsToExcel([{ name: cycle.name, meetings }], `פגישות - ${cycle.name}${suffix}`, false, filter);
}
