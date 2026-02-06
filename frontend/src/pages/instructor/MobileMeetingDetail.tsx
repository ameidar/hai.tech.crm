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
  Loader2
} from 'lucide-react';
import { 
  useMeeting, 
  useUpdateMeeting,
  useMeetingAttendance,
  useRecordAttendance,
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
  const updateMeeting = useUpdateMeeting();
  const recordAttendance = useRecordAttendance();

  const [status, setStatus] = useState<MeetingStatus | null>(null);
  const [topic, setTopic] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize form when meeting loads
  useMemo(() => {
    if (meeting && status === null) {
      setStatus(meeting.status);
      setTopic(meeting.topic || '');
    }
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
      // Show success feedback
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
        </div>

        {/* Status Selection */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-3">סטטוס השיעור</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleStatusButtonClick('completed')}
              className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${
                status === 'completed'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <CheckCircle2 size={28} />
              <span className="font-medium">הושלם</span>
            </button>
            <button
              onClick={() => handleStatusButtonClick('cancelled')}
              className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${
                status === 'cancelled'
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <XCircle size={28} />
              <span className="font-medium">בוטל</span>
            </button>
          </div>
        </div>

        {/* Topic Input */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
            <MessageSquare size={16} />
            מה למדתם היום?
          </h2>
          <input
            type="text"
            value={topic}
            onChange={(e) => handleTopicChange(e.target.value)}
            placeholder="לדוגמה: לולאות ותנאים, פרויקט משחק..."
            className="w-full p-4 rounded-2xl border border-gray-200 text-lg focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
          />
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
                  
                  {/* Big Touch-Friendly Buttons */}
                  <div className="flex gap-2">
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
    </div>
  );
}
