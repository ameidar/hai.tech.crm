import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowRight,
  Clock, 
  MapPin, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Users,
  Video,
  Building2,
  Check,
  UserMinus,
  MessageSquare,
  Save,
  Loader2,
  CalendarX,
  CalendarClock,
  UserCog,
  X
} from 'lucide-react';
import { 
  useMeeting, 
  useUpdateMeeting,
  useMeetingAttendance,
  useRecordAttendance,
  useMeetingChangeRequests,
  useCreateMeetingChangeRequest,
  type AttendanceRecord
} from '../../hooks/useApi';
import Loading from '../../components/ui/Loading';
import { meetingStatusHebrew } from '../../types';
import type { MeetingStatus } from '../../types';

/**
 * Mobile-optimized meeting detail page for instructors
 * One-page experience for updating status, topic, and attendance
 */
export default function MobileMeetingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const { data: meeting, isLoading: meetingLoading } = useMeeting(id);
  const { data: attendanceData, isLoading: attendanceLoading } = useMeetingAttendance(id);
  const { data: pendingRequests } = useMeetingChangeRequests({ meetingId: id, status: 'pending' });
  const updateMeeting = useUpdateMeeting();
  const recordAttendance = useRecordAttendance();
  const createChangeRequest = useCreateMeetingChangeRequest();

  const [status, setStatus] = useState<MeetingStatus | null>(null);
  const [topic, setTopic] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  
  // Request modal state
  const [requestModal, setRequestModal] = useState<{ open: boolean; type: 'cancel' | 'postpone' | 'replacement' | null }>({ open: false, type: null });
  const [requestReason, setRequestReason] = useState('');
  const [requestSuccess, setRequestSuccess] = useState(false);

  // Initialize form when meeting loads
  useMemo(() => {
    if (meeting && status === null) {
      setStatus(meeting.status);
      setTopic(meeting.topic || '');
    }
  }, [meeting]);

  // Meeting timing logic
  const meetingTiming = useMemo(() => {
    if (!meeting) return { isToday: false, isFuture: false, isPast: false, isCompleted: false };
    const today = new Date().toISOString().split('T')[0];
    const meetingDate = meeting.scheduledDate.split('T')[0];
    const isCompleted = meeting.status === 'completed';
    const isCancelled = meeting.status === 'cancelled';
    const isToday = meetingDate === today;
    const isFuture = meetingDate > today;
    const isPast = meetingDate < today;
    return {
      isToday,
      isFuture,
      isPast,
      isCompleted,
      isCancelled,
      // Can update status + topic + attendance: only today's scheduled meetings
      canUpdate: isToday && !isCompleted && !isCancelled,
      // Can request changes: today or future scheduled meetings
      canRequest: (isToday || isFuture) && !isCompleted && !isCancelled,
      // View only: completed or past meetings
      viewOnly: isCompleted || isPast || isCancelled,
    };
  }, [meeting]);

  const formatTime = (time: string) => {
    if (time.includes('T')) {
      const date = new Date(time);
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    return time.substring(0, 5);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  };

  const handleStatusChange = async (
    record: AttendanceRecord,
    newStatus: 'present' | 'absent' | 'late'
  ) => {
    if (!id) return;
    try {
      await recordAttendance.mutateAsync({
        meetingId: id,
        data: {
          registrationId: record.registrationId || undefined,
          studentId: record.studentId || undefined,
          status: newStatus,
          isTrial: record.isTrial,
        },
      });
    } catch (error) {
      console.error('Failed to record attendance:', error);
    }
  };

  const handleSave = async () => {
    if (!id || !status) return;
    try {
      await updateMeeting.mutateAsync({
        id,
        data: { status, topic: topic || undefined },
      });
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to update meeting:', error);
      alert('שגיאה בשמירה');
    }
  };

  const handleTopicChange = (value: string) => {
    setTopic(value);
    setHasChanges(true);
  };

  const handleStatusButtonClick = (newStatus: MeetingStatus) => {
    setStatus(newStatus);
    setHasChanges(true);
  };

  const openRequestModal = (type: 'cancel' | 'postpone' | 'replacement') => {
    setRequestModal({ open: true, type });
    setRequestReason('');
    setRequestSuccess(false);
  };

  const handleSubmitRequest = async () => {
    if (!id || !requestModal.type || !requestReason.trim()) return;
    try {
      await createChangeRequest.mutateAsync({
        meetingId: id,
        type: requestModal.type,
        reason: requestReason.trim(),
      });
      setRequestSuccess(true);
      setTimeout(() => {
        setRequestModal({ open: false, type: null });
        setRequestSuccess(false);
      }, 2000);
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'שגיאה בשליחת הבקשה';
      alert(msg);
    }
  };

  const typeHebrew: Record<string, string> = {
    cancel: 'ביטול',
    postpone: 'דחייה',
    replacement: 'החלפה',
  };

  if (meetingLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loading size="lg" text="טוען פגישה..." />
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="p-4 text-center">
        <p className="text-gray-500">פגישה לא נמצאה</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-blue-600">
          חזור
        </button>
      </div>
    );
  }

  const isOnline = meeting.cycle?.activityType === 'online';

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 z-30">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 -mr-2 text-gray-500 hover:text-gray-700"
        >
          <ArrowRight size={24} />
        </button>
        <div className="flex-1">
          <h1 className="font-semibold text-gray-800 truncate">
            {meeting.cycle?.name || 'פגישה'}
          </h1>
          <p className="text-sm text-gray-500">
            {formatDate(meeting.scheduledDate)} • {formatTime(meeting.startTime)}
          </p>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Meeting Info Card */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 text-gray-600">
            <Clock size={18} />
            <span>{formatTime(meeting.startTime)} - {formatTime(meeting.endTime)}</span>
          </div>
          <div className="flex items-center gap-3 text-gray-600 mt-2">
            {isOnline ? (
              <>
                <Video size={18} />
                <span>שיעור אונליין</span>
              </>
            ) : (
              <>
                <Building2 size={18} />
                <span>{meeting.cycle?.branch?.name || 'סניף'}</span>
              </>
            )}
          </div>
          
          {/* Join Zoom Button */}
          {isOnline && meeting.zoomJoinUrl && meeting.status === 'scheduled' && (
            <a
              href={meeting.zoomJoinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 w-full py-4 bg-blue-600 text-white rounded-xl font-medium text-lg flex items-center justify-center gap-3 hover:bg-blue-700 active:scale-[0.98] transition-all shadow-lg shadow-blue-200"
            >
              <Video size={22} />
              הצטרף לפגישת Zoom
            </a>
          )}
        </div>

        {/* Pending Requests */}
        {pendingRequests && pendingRequests.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <h3 className="text-sm font-medium text-amber-800 mb-2 flex items-center gap-2">
              <AlertCircle size={16} />
              בקשות ממתינות
            </h3>
            {pendingRequests.map((req) => (
              <div key={req.id} className="text-sm text-amber-700 mt-1">
                בקשת {typeHebrew[req.type]} — {req.reason}
              </div>
            ))}
          </div>
        )}

        {/* Status Selection — only for today's meetings */}
        {meetingTiming.canUpdate && (
          <div>
            <h2 className="text-sm font-medium text-gray-700 mb-3">סטטוס השיעור</h2>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => handleStatusButtonClick('completed')}
                className={`p-4 rounded-2xl border-2 flex items-center gap-3 transition-all ${
                  status === 'completed'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <CheckCircle2 size={28} />
                <span className="font-medium text-lg">הושלם</span>
              </button>
            </div>
          </div>
        )}

        {/* Current status display for non-editable meetings */}
        {!meetingTiming.canUpdate && (
          <div className="bg-gray-50 rounded-2xl p-4 flex items-center gap-3">
            <span className="text-sm text-gray-500">סטטוס:</span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              meeting.status === 'completed' ? 'bg-green-100 text-green-700' :
              meeting.status === 'cancelled' ? 'bg-red-100 text-red-700' :
              meeting.status === 'postponed' ? 'bg-amber-100 text-amber-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {meetingStatusHebrew[meeting.status]}
            </span>
          </div>
        )}

        {/* Change Request Buttons — only for future meetings */}
        {meetingTiming.canRequest && (
          <div>
            <h2 className="text-sm font-medium text-gray-700 mb-3">בקשות שינוי</h2>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => openRequestModal('cancel')}
                className="p-4 rounded-2xl border-2 border-red-200 bg-red-50 text-red-700 flex items-center gap-3 hover:border-red-400 transition-all active:scale-[0.98]"
              >
                <CalendarX size={24} />
                <span className="font-medium">בקש ביטול</span>
              </button>
              <button
                onClick={() => openRequestModal('postpone')}
                className="p-4 rounded-2xl border-2 border-amber-200 bg-amber-50 text-amber-700 flex items-center gap-3 hover:border-amber-400 transition-all active:scale-[0.98]"
              >
                <CalendarClock size={24} />
                <span className="font-medium">בקש דחייה</span>
              </button>
              <button
                onClick={() => openRequestModal('replacement')}
                className="p-4 rounded-2xl border-2 border-blue-200 bg-blue-50 text-blue-700 flex items-center gap-3 hover:border-blue-400 transition-all active:scale-[0.98]"
              >
                <UserCog size={24} />
                <span className="font-medium">בקש החלפה</span>
              </button>
            </div>
          </div>
        )}

        {/* Topic Input — editable only for today */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
            <MessageSquare size={16} />
            {meetingTiming.canUpdate ? 'מה למדתם היום?' : 'נושא השיעור'}
          </h2>
          {meetingTiming.canUpdate ? (
            <input
              type="text"
              value={topic}
              onChange={(e) => handleTopicChange(e.target.value)}
              placeholder="לדוגמה: לולאות ותנאים, פרויקט משחק..."
              className="w-full p-4 rounded-2xl border border-gray-200 text-lg focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
            />
          ) : (
            <p className="p-4 rounded-2xl bg-gray-50 text-gray-600">{topic || 'לא צוין'}</p>
          )}
        </div>

        {/* Attendance Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Users size={16} />
              נוכחות
            </h2>
            {attendanceData && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-green-600">{attendanceData.stats.present} נוכחים</span>
                <span className="text-gray-300">|</span>
                <span className="text-gray-500">{attendanceData.stats.total} סה"כ</span>
              </div>
            )}
          </div>

          {attendanceLoading ? (
            <div className="bg-white rounded-2xl p-6 border border-gray-100 text-center">
              <Loading size="sm" text="טוען רשימת תלמידים..." />
            </div>
          ) : attendanceData && attendanceData.attendance.length > 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {attendanceData.attendance.map((record, idx) => (
                <div
                  key={record.registrationId || record.studentId || idx}
                  className={`p-4 flex items-center justify-between ${
                    record.isTrial ? 'bg-blue-50' : ''
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">{record.studentName}</span>
                      {record.isTrial && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                          ניסיון
                        </span>
                      )}
                    </div>
                    {record.grade && (
                      <span className="text-sm text-gray-500">כיתה {record.grade}</span>
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    {meetingTiming.canUpdate ? (
                      <>
                        <button
                          onClick={() => handleStatusChange(record, 'present')}
                          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                            record.status === 'present'
                              ? 'bg-green-500 text-white shadow-lg shadow-green-200'
                              : 'bg-gray-100 text-gray-400 hover:bg-green-100 hover:text-green-600'
                          }`}
                        >
                          <Check size={24} />
                        </button>
                        <button
                          onClick={() => handleStatusChange(record, 'absent')}
                          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                            record.status === 'absent'
                              ? 'bg-red-500 text-white shadow-lg shadow-red-200'
                              : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-600'
                          }`}
                        >
                          <UserMinus size={24} />
                        </button>
                        <button
                          onClick={() => handleStatusChange(record, 'late')}
                          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                            record.status === 'late'
                              ? 'bg-amber-500 text-white shadow-lg shadow-amber-200'
                              : 'bg-gray-100 text-gray-400 hover:bg-amber-100 hover:text-amber-600'
                          }`}
                        >
                          <Clock size={24} />
                        </button>
                      </>
                    ) : (
                      <span className={`px-3 py-1 rounded-full text-sm ${
                        record.status === 'present' ? 'bg-green-100 text-green-700' :
                        record.status === 'absent' ? 'bg-red-100 text-red-700' :
                        record.status === 'late' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {record.status === 'present' ? 'נוכח' : record.status === 'absent' ? 'חסר' : record.status === 'late' ? 'איחור' : 'לא דווח'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-6 border border-gray-100 text-center text-gray-500">
              אין תלמידים רשומים
            </div>
          )}
        </div>
      </div>

      {/* Fixed Save Button */}
      {hasChanges && (
        <div className="fixed bottom-20 left-4 right-4 z-40">
          <button
            onClick={handleSave}
            disabled={updateMeeting.isPending}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-medium text-lg shadow-lg shadow-blue-200 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            {updateMeeting.isPending ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                שומר...
              </>
            ) : (
              <>
                <Save size={20} />
                שמור שינויים
              </>
            )}
          </button>
        </div>
      )}

      {/* Request Modal */}
      {requestModal.open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setRequestModal({ open: false, type: null })}>
          <div 
            className="w-full max-w-lg bg-white rounded-t-3xl p-6 pb-8 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            {requestSuccess ? (
              <div className="text-center py-8">
                <CheckCircle2 size={48} className="mx-auto mb-4 text-green-500" />
                <p className="text-lg font-medium text-gray-800">הבקשה נשלחה לאישור</p>
                <p className="text-sm text-gray-500 mt-1">תקבל עדכון כשהבקשה תטופל</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-gray-800">
                    בקשת {requestModal.type ? typeHebrew[requestModal.type] : ''}
                  </h3>
                  <button onClick={() => setRequestModal({ open: false, type: null })} className="p-1 text-gray-400">
                    <X size={24} />
                  </button>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    סיבה (חובה)
                  </label>
                  <textarea
                    value={requestReason}
                    onChange={(e) => setRequestReason(e.target.value)}
                    placeholder="נא לפרט את הסיבה לבקשה..."
                    rows={3}
                    className="w-full p-4 rounded-xl border border-gray-200 text-base focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all resize-none"
                    autoFocus
                  />
                </div>
                <button
                  onClick={handleSubmitRequest}
                  disabled={!requestReason.trim() || createChangeRequest.isPending}
                  className="w-full py-4 bg-blue-600 text-white rounded-xl font-medium text-lg flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all"
                >
                  {createChangeRequest.isPending ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      שולח...
                    </>
                  ) : (
                    'שלח בקשה'
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
