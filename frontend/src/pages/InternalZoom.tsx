import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Trash2,
  Video,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { useAuth } from '../context/AuthContext';
import {
  useCancelInternalZoomMeeting,
  useCreateInternalZoomMeeting,
  useInternalZoomMeetings,
} from '../hooks/useApi';
import type { InternalZoomMeeting, VideoMeetingProvider } from '../types';

function todayInput() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysInput(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function zoomStatus(meeting: InternalZoomMeeting) {
  if (meeting.status === 'cancelled') {
    return 'bg-gray-100 text-gray-600 border-gray-200';
  }
  if (new Date(meeting.endAt) < new Date()) {
    return 'bg-slate-100 text-slate-700 border-slate-200';
  }
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

function providerLabel(provider?: VideoMeetingProvider) {
  return provider === 'google_meet' ? 'Google Meet' : 'Zoom';
}

export default function InternalZoom() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    title: '',
    requesterName: user?.name || '',
    date: todayInput(),
    startTime: '10:00',
    durationMinutes: 60,
    videoProvider: 'google_meet' as VideoMeetingProvider,
    notes: '',
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => ({ from: todayInput(), to: addDaysInput(30) }), []);
  const { data: meetings = [], isLoading } = useInternalZoomMeetings(range);
  const createMeeting = useCreateInternalZoomMeeting();
  const cancelMeeting = useCancelInternalZoomMeeting();

  const scheduled = meetings.filter((meeting) => meeting.status === 'scheduled');
  const cancelledOrPast = meetings.filter((meeting) => meeting.status !== 'scheduled');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const result = await createMeeting.mutateAsync({
        ...form,
        title: form.title.trim(),
        requesterName: form.requesterName.trim(),
        notes: form.notes.trim() || undefined,
      });
      setForm((current) => ({
        ...current,
        title: '',
        notes: '',
      }));
      if (result.meeting.zoomJoinUrl) {
        await navigator.clipboard?.writeText(result.meeting.zoomJoinUrl);
        setCopiedId(result.meeting.id);
        window.setTimeout(() => setCopiedId(null), 1800);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'שגיאה ביצירת לינק וידאו');
    }
  };

  const copyZoom = async (meeting: InternalZoomMeeting) => {
    if (!meeting.zoomJoinUrl) return;
    await navigator.clipboard?.writeText(meeting.zoomJoinUrl);
    setCopiedId(meeting.id);
    window.setTimeout(() => setCopiedId(null), 1800);
  };

  const handleCancel = (meeting: InternalZoomMeeting) => {
    if (!window.confirm(`לבטל את פגישת הווידאו "${meeting.title}"?`)) return;
    cancelMeeting.mutate(meeting.id);
  };

  const renderMeeting = (meeting: InternalZoomMeeting) => (
    <article
      key={meeting.id}
      className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900">{meeting.title}</h3>
            <span className="inline-flex items-center border border-blue-200 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs">
              {providerLabel(meeting.videoProvider)}
            </span>
            <span className={`inline-flex items-center border px-2 py-0.5 rounded-full text-xs ${zoomStatus(meeting)}`}>
              {meeting.status === 'cancelled' ? 'בוטל' : new Date(meeting.endAt) < new Date() ? 'עבר' : 'משובץ'}
            </span>
          </div>
          <div className="mt-1 text-sm text-gray-600">
            {formatDateTime(meeting.startAt)} עד {meeting.endTime} · {meeting.durationMinutes} דק׳ · {meeting.requesterName}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Host: {meeting.zoomHostEmail || '-'} {meeting.zoomHostKey ? `· קוד מנהל ${meeting.zoomHostKey}` : ''}
          </div>
          {meeting.notes && <p className="mt-2 text-sm text-gray-600">{meeting.notes}</p>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {meeting.zoomJoinUrl && (
            <>
              <button
                type="button"
                onClick={() => copyZoom(meeting)}
                className="p-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
                title="העתק לינק"
              >
                {copiedId === meeting.id ? <Check size={18} /> : <Copy size={18} />}
              </button>
              <a
                href={meeting.zoomJoinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
                title={`פתח ${providerLabel(meeting.videoProvider)}`}
              >
                <ExternalLink size={18} />
              </a>
            </>
          )}
          {meeting.status === 'scheduled' && (
            <button
              type="button"
              onClick={() => handleCancel(meeting)}
              disabled={cancelMeeting.isPending}
              className="p-2 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
              title="בטל פגישת וידאו"
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </div>
    </article>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="פגישות וידאו פנימיות" />

      <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
          <label className="lg:col-span-2">
            <span className="block text-sm font-medium text-gray-700 mb-1">כותרת</span>
            <input
              required
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="פגישת צוות"
            />
          </label>

          <label className="lg:col-span-2">
            <span className="block text-sm font-medium text-gray-700 mb-1">מבקש/ת</span>
            <input
              required
              value={form.requesterName}
              onChange={(event) => setForm({ ...form, requesterName: event.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </label>

          <label className="lg:col-span-2">
            <span className="block text-sm font-medium text-gray-700 mb-1">תאריך</span>
            <input
              required
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </label>

          <label className="lg:col-span-1">
            <span className="block text-sm font-medium text-gray-700 mb-1">שעה</span>
            <input
              required
              type="time"
              value={form.startTime}
              onChange={(event) => setForm({ ...form, startTime: event.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </label>

          <label className="lg:col-span-1">
            <span className="block text-sm font-medium text-gray-700 mb-1">דקות</span>
            <input
              required
              type="number"
              min={15}
              max={480}
              step={15}
              value={form.durationMinutes}
              onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </label>

          <label className="lg:col-span-2">
            <span className="block text-sm font-medium text-gray-700 mb-1">ספק</span>
            <select
              value={form.videoProvider}
              onChange={(event) => setForm({ ...form, videoProvider: event.target.value as VideoMeetingProvider })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="google_meet">Google Meet</option>
              <option value="zoom">Zoom</option>
            </select>
          </label>

          <label className="lg:col-span-2">
            <span className="block text-sm font-medium text-gray-700 mb-1">הערות</span>
            <input
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </label>

          <button
            type="submit"
            disabled={createMeeting.isPending}
            className="lg:col-span-1 inline-flex items-center justify-center gap-2 bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 min-h-[38px]"
          >
            {createMeeting.isPending ? <Loader2 size={18} className="animate-spin" /> : <Video size={18} />}
            צור
          </button>
        </form>

        {error && (
          <div className="mt-4 border border-red-200 bg-red-50 text-red-700 rounded-md px-3 py-2 text-sm">
            {error}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-gray-800">
          <CalendarClock size={20} />
          <h2 className="font-semibold">פגישות וידאו משובצות</h2>
        </div>

        {isLoading ? (
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-500">טוען...</div>
        ) : scheduled.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-500">אין פגישות וידאו פנימיות משובצות</div>
        ) : (
          scheduled.map(renderMeeting)
        )}
      </section>

      {cancelledOrPast.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-gray-800">ארכיון קרוב</h2>
          {cancelledOrPast.map(renderMeeting)}
        </section>
      )}
    </div>
  );
}
