import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban, CalendarClock, ClipboardList, Filter, RefreshCw } from 'lucide-react';
import api from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import { useInstructors, type MeetingChangeRequest } from '../hooks/useApi';

interface InstructorSummary {
  instructorId: string;
  instructorName: string;
  total: number;
  cancel: number;
  postpone: number;
  replacement: number;
  pending: number;
  approved: number;
  rejected: number;
  lastRequestAt: string | null;
}

interface MeetingChangeLogResponse {
  summary: {
    totals: {
      total: number;
      cancel: number;
      postpone: number;
      replacement: number;
      pending: number;
      approved: number;
      rejected: number;
    };
    byInstructor: InstructorSummary[];
  };
  requests: MeetingChangeRequest[];
}

interface StudentOption {
  id: string;
  name: string;
}

const typeLabels: Record<string, string> = {
  cancel: 'ביטול',
  postpone: 'דחייה',
  replacement: 'החלפה',
};

const statusLabels: Record<string, string> = {
  pending: 'ממתין',
  approved: 'אושר',
  rejected: 'נדחה',
};

const typeClasses: Record<string, string> = {
  cancel: 'bg-red-100 text-red-700',
  postpone: 'bg-amber-100 text-amber-700',
  replacement: 'bg-blue-100 text-blue-700',
};

const statusClasses: Record<string, string> = {
  pending: 'bg-orange-100 text-orange-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-gray-100 text-gray-700',
};

function dateInput(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatTime(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function studentNamesForRequest(request: MeetingChangeRequest) {
  const directStudent = request.meeting?.registration?.student;
  if (directStudent) return [directStudent.name];

  const names = new Set<string>();
  for (const registration of request.meeting?.cycle?.registrations ?? []) {
    if (registration.student?.name) names.add(registration.student.name);
  }
  return Array.from(names);
}

export default function MeetingChangeLog() {
  const [instructorId, setInstructorId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [type, setType] = useState<'all' | 'cancel' | 'postpone' | 'replacement'>('all');
  const [status, setStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [from, setFrom] = useState(dateInput(-30));
  const [to, setTo] = useState(dateInput(0));

  const { data: instructors = [] } = useInstructors({ isActive: true });

  useEffect(() => {
    setStudentId('');
  }, [instructorId]);

  const studentOptionsQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (instructorId) params.set('instructorId', instructorId);
    if (type !== 'all') params.set('type', type);
    if (status !== 'all') params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [from, instructorId, status, to, type]);

  const { data: studentOptions = [], isFetching: isFetchingStudents } = useQuery({
    queryKey: ['meeting-change-log-students', studentOptionsQueryString],
    queryFn: async () => {
      const response = await api.get<{ students: StudentOption[] }>(`/meeting-requests/log/students?${studentOptionsQueryString}`);
      return response.data.students;
    },
    enabled: !!instructorId,
  });

  useEffect(() => {
    if (studentId && !isFetchingStudents && !studentOptions.some((student) => student.id === studentId)) {
      setStudentId('');
    }
  }, [isFetchingStudents, studentId, studentOptions]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (instructorId) params.set('instructorId', instructorId);
    if (studentId) params.set('studentId', studentId);
    if (type !== 'all') params.set('type', type);
    if (status !== 'all') params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('limit', '500');
    return params.toString();
  }, [from, instructorId, status, studentId, to, type]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['meeting-change-log', queryString],
    queryFn: async () => {
      const response = await api.get<MeetingChangeLogResponse>(`/meeting-requests/log?${queryString}`);
      return response.data;
    },
  });

  const totals = data?.summary.totals;
  const rows = data?.requests ?? [];
  const instructorSummary = data?.summary.byInstructor ?? [];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="לוג דחיות וביטולים"
        subtitle="מעקב לפי מדריך אחרי בקשות ביטול ודחיית מפגשים"
        actions={
          <button
            type="button"
            onClick={() => refetch()}
            className="btn btn-secondary flex items-center gap-2"
            disabled={isFetching}
          >
            <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
            רענן
          </button>
        }
      />

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-gray-700 font-medium mb-3">
          <Filter size={18} />
          סינון
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <select value={instructorId} onChange={(e) => setInstructorId(e.target.value)} className="form-select">
            <option value="">כל המדריכים</option>
            {instructors.map((instructor) => (
              <option key={instructor.id} value={instructor.id}>{instructor.name}</option>
            ))}
          </select>
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="form-select"
            disabled={!instructorId || isFetchingStudents}
          >
            <option value="">
              {!instructorId ? 'בחרו מדריך קודם' : isFetchingStudents ? 'טוען תלמידים...' : 'כל התלמידים'}
            </option>
            {studentOptions.map((student) => (
              <option key={student.id} value={student.id}>{student.name}</option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="form-select">
            <option value="all">ביטולים ודחיות</option>
            <option value="cancel">ביטולים בלבד</option>
            <option value="postpone">דחיות בלבד</option>
            <option value="replacement">החלפות</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="form-select">
            <option value="all">כל הסטטוסים</option>
            <option value="pending">ממתין</option>
            <option value="approved">אושר</option>
            <option value="rejected">נדחה</option>
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="form-input" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="form-input" />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-sm text-gray-500">סה״כ בקשות</div>
              <div className="text-3xl font-semibold text-gray-900 mt-1">{totals?.total ?? 0}</div>
            </div>
            <div className="bg-white border border-red-100 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-red-600"><Ban size={16} /> ביטולים</div>
              <div className="text-3xl font-semibold text-red-700 mt-1">{totals?.cancel ?? 0}</div>
            </div>
            <div className="bg-white border border-amber-100 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-amber-600"><CalendarClock size={16} /> דחיות</div>
              <div className="text-3xl font-semibold text-amber-700 mt-1">{totals?.postpone ?? 0}</div>
            </div>
            <div className="bg-white border border-orange-100 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-orange-600"><AlertTriangle size={16} /> ממתינות</div>
              <div className="text-3xl font-semibold text-orange-700 mt-1">{totals?.pending ?? 0}</div>
            </div>
          </div>

          {instructorSummary.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">סיכום לפי מדריך</div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr className="text-right text-xs font-medium text-gray-500">
                      <th className="px-4 py-3">מדריך</th>
                      <th className="px-4 py-3">סה״כ</th>
                      <th className="px-4 py-3">ביטולים</th>
                      <th className="px-4 py-3">דחיות</th>
                      <th className="px-4 py-3">ממתין</th>
                      <th className="px-4 py-3">אחרון</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {instructorSummary.map((summary) => (
                      <tr key={summary.instructorId} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{summary.instructorName}</td>
                        <td className="px-4 py-3">{summary.total}</td>
                        <td className="px-4 py-3 text-red-700">{summary.cancel}</td>
                        <td className="px-4 py-3 text-amber-700">{summary.postpone}</td>
                        <td className="px-4 py-3 text-orange-700">{summary.pending}</td>
                        <td className="px-4 py-3 text-gray-500">{formatDateTime(summary.lastRequestAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">אירועים</div>
            {rows.length === 0 ? (
              <div className="p-8">
                <EmptyState title="אין אירועים בטווח שנבחר" icon={<ClipboardList size={40} />} />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr className="text-right text-xs font-medium text-gray-500">
                      <th className="px-4 py-3">תאריך בקשה</th>
                      <th className="px-4 py-3">מדריך</th>
                      <th className="px-4 py-3">סוג</th>
                      <th className="px-4 py-3">סטטוס</th>
                      <th className="px-4 py-3">מפגש</th>
                      <th className="px-4 py-3">תלמידים</th>
                      <th className="px-4 py-3">סיבה</th>
                      <th className="px-4 py-3">הערת טיפול</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {rows.map((request) => (
                      <tr key={request.id} className="hover:bg-gray-50 align-top">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDateTime(request.createdAt)}</td>
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{request.instructor?.name ?? '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${typeClasses[request.type]}`}>
                            {typeLabels[request.type]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${statusClasses[request.status]}`}>
                            {statusLabels[request.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 min-w-[260px]">
                          {request.meeting ? (
                            <div className="space-y-1">
                              <Link to={`/meetings?openMeeting=${request.meetingId}`} className="text-blue-600 hover:underline font-medium">
                                {request.meeting.cycle?.name ?? 'פתח מפגש'}
                              </Link>
                              <div className="text-gray-500">
                                {request.meeting.cycle?.branch?.name ? `${request.meeting.cycle.branch.name} · ` : ''}
                                {formatDate(request.meeting.scheduledDate)}
                                {request.meeting.startTime ? ` · ${formatTime(request.meeting.startTime)}` : ''}
                              </div>
                            </div>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-3 max-w-[220px] text-gray-700">
                          {(() => {
                            const names = studentNamesForRequest(request);
                            if (names.length === 0) return '-';
                            const visibleNames = names.slice(0, 3).join(', ');
                            return names.length > 3 ? `${visibleNames} ועוד ${names.length - 3}` : visibleNames;
                          })()}
                        </td>
                        <td className="px-4 py-3 max-w-[320px] text-gray-700 whitespace-pre-wrap">{request.reason || '-'}</td>
                        <td className="px-4 py-3 max-w-[260px] text-gray-600 whitespace-pre-wrap">{request.reviewNotes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
