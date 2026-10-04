import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCopy,
  Clock,
  Filter,
  ListTodo,
  PauseCircle,
  RefreshCw,
  Users2,
  XCircle,
} from 'lucide-react';
import api from '../api/client';

type AlertPriority = 'urgent' | 'high' | 'normal';
type IssueStatus = 'new' | 'in_progress' | 'waiting' | 'closed';
type AlertType =
  | 'past_scheduled_meeting'
  | 'missing_topic'
  | 'missing_attendance'
  | 'overdue_task'
  | 'low_profit'
  | 'student_absence_risk'
  | 'instructor_change_risk'
  | 'cycle_churn_risk'
  | 'low_enrollment'
  | 'lead_follow_up';
type FreshnessStatus = 'fresh' | 'stale' | 'error';

interface OperationsAlert {
  id: string;
  priority: AlertPriority;
  type: AlertType;
  title: string;
  entityType: 'meeting' | 'cycle' | 'task' | 'instructor' | 'lead';
  entityId: string;
  entityUrl: string;
  clientName: string | null;
  cycleName: string | null;
  instructorName: string | null;
  description: string;
  recommendedAction: string;
  detectedAt: string;
  taskId: string | null;
  status: IssueStatus;
  statusNote: string | null;
  statusUpdatedAt: string | null;
  contactName: string | null;
  contactUrl: string | null;
}

interface TodayMeeting {
  id: string;
  entityUrl: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  cycleType: string;
  activityType: string;
  cycleName: string;
  clientName: string | null;
  instructorName: string | null;
  hasTopic: boolean;
  attendanceMarked: boolean;
  attendanceCount: number;
  registrationCount: number;
}

interface InstructorLoad {
  instructorId: string;
  instructorName: string;
  todayCount: number;
  weekCount: number;
  missingReports: number;
  warningState: 'ok' | 'watch';
}

interface OpenTask {
  id: string;
  entityUrl: string;
  title: string;
  description: string | null;
  status: string;
  priority: AlertPriority | 'low';
  dueDate: string | null;
  assigneeName: string | null;
  assigneeRole: string | null;
}

interface OperationsControlResponse {
  success: true;
  generatedAt: string;
  timezone: string;
  date: string;
  operationsStartDate: string;
  freshness: {
    status: FreshnessStatus;
    generatedAt: string;
    message: string;
  };
  summary: {
    overallStatus: 'ok' | 'watch' | 'urgent' | 'data_error';
    urgentCount: number;
    highCount: number;
    normalCount: number;
    openTaskCount: number;
    todayMeetingCount: number;
    unresolvedMeetingCount: number;
  };
  alerts: OperationsAlert[];
  todayMeetings: TodayMeeting[];
  instructorLoad: InstructorLoad[];
  clientRisks: OperationsAlert[];
  openTasks: OpenTask[];
}

const priorityLabels: Record<AlertPriority | 'low', string> = {
  urgent: 'דחוף',
  high: 'גבוה',
  normal: 'רגיל',
  low: 'נמוך',
};

const typeLabels: Record<AlertType, string> = {
  past_scheduled_meeting: 'פגישה שעברה',
  missing_topic: 'חסר דיווח',
  missing_attendance: 'חסרה נוכחות',
  overdue_task: 'משימה באיחור',
  low_profit: 'רווחיות נמוכה',
  student_absence_risk: 'היעדרויות תלמידים',
  instructor_change_risk: 'ביטולי/דחיות מדריך',
  cycle_churn_risk: 'סיכון נטישה',
  low_enrollment: 'מתחת לסף מינימום',
  lead_follow_up: 'לידים למעקב',
};

const statusLabels: Record<string, string> = {
  scheduled: 'מתוכננת',
  completed: 'התקיימה',
  cancelled: 'בוטלה',
  postponed: 'נדחתה',
  pending_cancellation: 'ממתינה לביטול',
  pending_postponement: 'ממתינה לדחייה',
  new: 'חדשה',
  in_progress: 'בתהליך',
  waiting_info: 'ממתין למידע',
  completed_task: 'הושלמה',
};

const issueStatusLabels: Record<IssueStatus, string> = {
  new: 'חדש',
  in_progress: 'בטיפול',
  waiting: 'בהמתנה',
  closed: 'נסגר',
};

const cycleTypeLabels: Record<string, string> = {
  private: 'פרטי',
  trial_private: 'ניסיון פרטי',
  group: 'קבוצתי',
  institutional_per_child: 'מוסדי',
  institutional_fixed: 'מוסדי',
};

function formatIsraelTime(value: string | Date) {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function freshnessFromGeneratedAt(generatedAt?: string): { status: FreshnessStatus; message: string } {
  if (!generatedAt) return { status: 'error', message: 'לא ניתן לטעון נתוני תפעול' };
  const ageMinutes = (Date.now() - new Date(generatedAt).getTime()) / 60_000;
  if (ageMinutes < 5) return { status: 'fresh', message: 'המידע עודכן עכשיו' };
  if (ageMinutes <= 30) return { status: 'stale', message: 'המידע לא עודכן לאחרונה - לבדוק מקור נתונים' };
  return { status: 'error', message: 'לא ניתן לטעון נתוני תפעול' };
}

function badgeClass(priority: AlertPriority | 'low') {
  switch (priority) {
    case 'urgent':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'high':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'normal':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function statusBadge(status: FreshnessStatus) {
  if (status === 'fresh') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'stale') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

async function fetchOperationsControl(priority: string, type: string) {
  const params = new URLSearchParams();
  if (priority) params.set('priority', priority);
  if (type) params.set('type', type);
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await api.get<OperationsControlResponse>(`/operations-control/today${query}`);
  return response.data;
}

async function updateIssueStatus(input: { alert: OperationsAlert; status: IssueStatus }) {
  const { alert, status } = input;
  const response = await api.patch(`/operations-control/issues/${encodeURIComponent(alert.id)}/status`, {
    status,
    snapshot: {
      title: alert.title,
      type: alert.type,
      priority: alert.priority,
      entityType: alert.entityType,
      entityId: alert.entityId,
    },
  });
  return response.data;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
      {message}
    </div>
  );
}

export default function OperationsControl() {
  const [priority, setPriority] = useState('');
  const [type, setType] = useState('');
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['operations-control', priority, type],
    queryFn: () => fetchOperationsControl(priority, type),
    refetchInterval: 60_000,
  });

  const freshness = useMemo(
    () => (isError ? { status: 'error' as FreshnessStatus, message: 'לא ניתן לטעון נתוני תפעול' } : freshnessFromGeneratedAt(data?.generatedAt)),
    [data?.generatedAt, isError],
  );

  const updateStatus = useMutation({
    mutationFn: updateIssueStatus,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations-control'] });
    },
  });

  const summaryText = useMemo(() => {
    if (!data) return '';
    const byType = data.alerts.reduce<Record<string, number>>((acc, alert) => {
      acc[typeLabels[alert.type]] = (acc[typeLabels[alert.type]] || 0) + 1;
      return acc;
    }, {});
    const typeLines = Object.entries(byType).map(([label, count]) => `- ${label}: ${count}`).join('\n') || '- אין התראות';
    const openItems = data.alerts
      .filter((alert) => alert.priority === 'urgent' || alert.priority === 'high')
      .slice(0, 8)
      .map((alert) => `- ${priorityLabels[alert.priority]}: ${alert.title} (${alert.cycleName || alert.clientName || alert.instructorName || 'CRM'})`)
      .join('\n') || '- אין פריטים דחופים למעקב';
    return [
      `סיכום תפעול יומי - ${data.date}`,
      `פגישות היום: ${data.summary.todayMeetingCount}`,
      `התראות דחופות/גבוהות: ${data.summary.urgentCount + data.summary.highCount}`,
      '',
      'התראות לפי סוג:',
      typeLines,
      '',
      `משימות פתוחות: ${data.summary.openTaskCount}`,
      '',
      'נדרש למעקב מחר:',
      openItems,
    ].join('\n');
  }, [data]);

  const copySummary = async () => {
    if (!summaryText) return;
    await navigator.clipboard.writeText(summaryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="flex items-center gap-3 text-slate-600">
          <RefreshCw className="animate-spin" size={20} />
          טוען נתוני תפעול...
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-50 p-6" dir="rtl">
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-700">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={20} />
            לא ניתן לטעון נתוני תפעול
          </div>
          <p className="mt-2 text-sm">{error instanceof Error ? error.message : 'תקלה בטעינת API'}</p>
        </div>
      </div>
    );
  }

  const allClear = data.alerts.length === 0 && freshness.status === 'fresh';

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6" dir="rtl">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">מגדל שליטה</h1>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusBadge(freshness.status)}`}>
                  {freshness.message}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
                <span>תאריך עבודה: {data.date}</span>
                <span>התחלה: {data.operationsStartDate}</span>
                <span>נוצר: {formatIsraelTime(data.generatedAt)}</span>
                <span>שעון ישראל: {formatIsraelTime(new Date())}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Metric label="דחוף" value={data.summary.urgentCount} tone="red" />
              <Metric label="גבוה" value={data.summary.highCount} tone="amber" />
              <Metric label="רגיל" value={data.summary.normalCount} tone="blue" />
              <Metric label="פגישות" value={data.summary.todayMeetingCount} tone="slate" />
              <Metric label="משימות" value={data.summary.openTaskCount} tone="slate" />
            </div>
          </div>
        </header>

        {freshness.status !== 'fresh' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle size={18} />
              מצב הנתונים אינו תקין
            </div>
            <p className="mt-1 text-sm">לא מוצג מצב “הכל תקין” עד שהמידע נטען ומתעדכן כראוי.</p>
          </div>
        )}

        {allClear && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <CheckCircle2 size={22} />
              הכל נקי כרגע
            </div>
            <p className="mt-1 text-sm">אין התראות תפעוליות פתוחות על בסיס הנתונים שנטענו עכשיו.</p>
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-slate-800">
              <Filter size={18} />
              <h2 className="font-semibold">התראות לפי עדיפות וסוג</h2>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">כל העדיפויות</option>
                <option value="urgent">דחוף</option>
                <option value="high">גבוה</option>
                <option value="normal">רגיל</option>
              </select>
              <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">כל הסוגים</option>
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {data.alerts.length === 0 ? (
            <EmptyState message="אין התראות להצגה במסנן הנוכחי." />
          ) : (
            <div className="grid gap-3">
              {data.alerts.map((alert) => (
                <article key={alert.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(alert.priority)}`}>
                          {priorityLabels[alert.priority]}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
                          {typeLabels[alert.type]}
                        </span>
                        <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
                          {issueStatusLabels[alert.status]}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-slate-900">{alert.title}</h3>
                      <p className="mt-1 text-sm text-slate-600">{alert.description}</p>
                      <p className="mt-2 text-sm font-medium text-slate-800">פעולה מומלצת: {alert.recommendedAction}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        {alert.clientName && <span>{alert.clientName}</span>}
                        {alert.cycleName && <span>{alert.cycleName}</span>}
                        {alert.instructorName && <span>{alert.instructorName}</span>}
                      </div>
                      {alert.contactUrl && (
                        <Link to={alert.contactUrl} className="mt-3 inline-flex items-center justify-center rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
                          כרטיס לקוח: {alert.contactName || 'פתיחה'}
                        </Link>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                      <Link to={alert.entityUrl} className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                        פתיחה ב-CRM
                      </Link>
                      <button
                        type="button"
                        onClick={() => updateStatus.mutate({ alert, status: 'in_progress' })}
                        disabled={updateStatus.isPending}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                      >
                        <CheckCircle2 size={16} />
                        בטיפול
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus.mutate({ alert, status: 'waiting' })}
                        disabled={updateStatus.isPending}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-200 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                      >
                        <PauseCircle size={16} />
                        בהמתנה
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus.mutate({ alert, status: 'closed' })}
                        disabled={updateStatus.isPending}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                      >
                        <XCircle size={16} />
                        נסגר
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle icon={<CalendarDays size={18} />} title="פגישות היום" />
            {data.todayMeetings.length === 0 ? (
              <EmptyState message="אין פגישות להיום." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="px-2 py-2 text-right">שעה</th>
                      <th className="px-2 py-2 text-right">מחזור</th>
                      <th className="px-2 py-2 text-right">סוג</th>
                      <th className="px-2 py-2 text-right">מדריך</th>
                      <th className="px-2 py-2 text-right">סטטוס</th>
                      <th className="px-2 py-2 text-right">דיווח</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.todayMeetings.map((meeting) => (
                      <tr key={meeting.id} className="align-top">
                        <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-800">{meeting.startTime}</td>
                        <td className="px-2 py-2">
                          <Link to={meeting.entityUrl} className="font-medium text-blue-700 hover:underline">{meeting.cycleName}</Link>
                          {meeting.clientName && <div className="text-xs text-slate-500">{meeting.clientName}</div>}
                        </td>
                        <td className="px-2 py-2 text-slate-700">{cycleTypeLabels[meeting.cycleType] || meeting.cycleType || '-'}</td>
                        <td className="px-2 py-2 text-slate-700">{meeting.instructorName || '-'}</td>
                        <td className="px-2 py-2 text-slate-700">{statusLabels[meeting.status] || meeting.status}</td>
                        <td className="px-2 py-2 text-slate-600">
                          {meeting.hasTopic ? 'יש סיכום' : 'חסר סיכום'} · {meeting.attendanceMarked ? 'נוכחות סומנה' : 'חסרה נוכחות'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle icon={<Users2 size={18} />} title="עומס מדריכים" />
            {data.instructorLoad.length === 0 ? (
              <EmptyState message="אין עומסי מדריכים להצגה." />
            ) : (
              <div className="grid gap-2">
                {data.instructorLoad.map((row) => (
                  <div key={row.instructorId} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                    <div>
                      <div className="font-medium text-slate-900">{row.instructorName}</div>
                      <div className="text-xs text-slate-500">היום {row.todayCount} · שבוע {row.weekCount} · דיווחים חסרים {row.missingReports}</div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${row.warningState === 'watch' ? 'border-amber-200 bg-amber-100 text-amber-700' : 'border-emerald-200 bg-emerald-100 text-emerald-700'}`}>
                      {row.warningState === 'watch' ? 'מעקב' : 'תקין'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle icon={<ListTodo size={18} />} title="משימות תפעול פתוחות" />
            {data.openTasks.length === 0 ? (
              <EmptyState message="אין משימות תפעול פתוחות או באיחור." />
            ) : (
              <div className="grid gap-2">
                {data.openTasks.map((task) => (
                  <Link key={task.id} to={task.entityUrl} className="block rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(task.priority)}`}>
                        {priorityLabels[task.priority]}
                      </span>
                      <span className="text-sm font-medium text-slate-900">{task.title}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>{statusLabels[task.status] || task.status}</span>
                      <span>{task.assigneeName || 'ללא אחראי'}</span>
                      {task.dueDate && <span>יעד: {formatIsraelTime(task.dueDate)}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <SectionTitle icon={<ClipboardCopy size={18} />} title="סיכום סוף יום" />
            <textarea
              value={summaryText}
              readOnly
              className="h-64 w-full resize-none rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm leading-6 text-slate-700"
            />
            <button
              onClick={copySummary}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              <ClipboardCopy size={16} />
              {copied ? 'הועתק' : 'העתק סיכום'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'red' | 'amber' | 'blue' | 'slate' }) {
  const tones = {
    red: 'text-red-700 bg-red-50 border-red-100',
    amber: 'text-amber-700 bg-amber-50 border-amber-100',
    blue: 'text-blue-700 bg-blue-50 border-blue-100',
    slate: 'text-slate-700 bg-slate-50 border-slate-100',
  };
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${tones[tone]}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-slate-800">
      {icon}
      <h2 className="font-semibold">{title}</h2>
      <Clock size={14} className="mr-auto text-slate-400" />
    </div>
  );
}
