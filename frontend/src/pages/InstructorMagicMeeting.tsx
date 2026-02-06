import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { 
  Clock, 
  MapPin, 
  CheckCircle2, 
  XCircle, 
  Users,
  Video,
  Building2,
  Check,
  UserMinus,
  MessageSquare,
  Save,
  Loader2,
  AlertCircle,
  ExternalLink
} from 'lucide-react';
import Loading from '../components/ui/Loading';
import type { MeetingStatus } from '../types';

/**
 * Magic link meeting page for instructors
 * No login required - authenticated via token in URL
 */

interface AttendanceRecord {
  registrationId: string;
  studentId: string;
  studentName: string;
  grade?: string;
  customerName?: string;
  customerPhone?: string;
  status: 'present' | 'absent' | 'late' | null;
  isTrial: boolean;
}

interface MeetingData {
  meeting: {
    id: string;
    scheduledDate: string;
    startTime: string;
    endTime: string;
    status: MeetingStatus;
    topic?: string;
    cycleName: string;
    branchName?: string;
    activityType?: string;
    zoomJoinUrl?: string;
  };
  instructor: {
    id: string;
    name: string;
  };
  attendance: AttendanceRecord[];
  stats: {
    total: number;
    present: number;
    absent: number;
    unmarked: number;
  };
}

export default function InstructorMagicMeeting() {
  const { meetingId, token } = useParams<{ meetingId: string; token: string }>();
  
  const [data, setData] = useState<MeetingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  
  const [status, setStatus] = useState<MeetingStatus>('scheduled');
  const [topic, setTopic] = useState('');
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch meeting data
  useEffect(() => {
    async function fetchData() {
      if (!meetingId || !token) return;
      
      try {
        const response = await fetch(`/api/instructor-magic/verify/${meetingId}/${token}`);
        const result = await response.json();
        
        if (!response.ok) {
          setError(result.message || 'שגיאה בטעינת הפגישה');
          return;
        }
        
        setData(result);
        setStatus(result.meeting.status);
        setTopic(result.meeting.topic || '');
        setAttendance(result.attendance);
      } catch (err) {
        setError('שגיאה בחיבור לשרת');
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, [meetingId, token]);

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

  const handleAttendanceChange = (registrationId: string, newStatus: 'present' | 'absent' | 'late') => {
    setAttendance(prev => prev.map(record => 
      record.registrationId === registrationId 
        ? { ...record, status: newStatus }
        : record
    ));
    setHasChanges(true);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!meetingId || !token) return;
    
    setSaving(true);
    try {
      const response = await fetch(`/api/instructor-magic/update/${meetingId}/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          topic,
          attendance: attendance.filter(a => a.status).map(a => ({
            registrationId: a.registrationId,
            studentId: a.studentId,
            status: a.status,
            isTrial: a.isTrial,
          })),
        }),
      });
      
      if (response.ok) {
        setSaved(true);
        setHasChanges(false);
      } else {
        alert('שגיאה בשמירה');
      }
    } catch (err) {
      alert('שגיאה בחיבור לשרת');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loading size="lg" text="טוען פגישה..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 text-center max-w-md shadow-lg">
          <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-800 mb-2">שגיאה</h1>
          <p className="text-gray-600">{error}</p>
          <p className="text-sm text-gray-400 mt-4">
            ייתכן שהלינק פג תוקף או לא תקף
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { meeting, instructor } = data;
  const isOnline = meeting.activityType === 'online';

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-30">
        <div className="max-w-lg mx-auto">
          <p className="text-sm text-gray-500">שלום {instructor.name}! 👋</p>
          <h1 className="font-bold text-gray-800 text-lg truncate">
            {meeting.cycleName}
          </h1>
          <p className="text-sm text-gray-500">
            {formatDate(meeting.scheduledDate)} • {formatTime(meeting.startTime)}
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-6">
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
                {meeting.zoomJoinUrl && (
                  <a 
                    href={meeting.zoomJoinUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="mr-auto text-blue-600 flex items-center gap-1 text-sm"
                  >
                    <ExternalLink size={14} />
                    פתח זום
                  </a>
                )}
              </>
            ) : (
              <>
                <Building2 size={18} />
                <span>{meeting.branchName || 'סניף'}</span>
              </>
            )}
          </div>
        </div>

        {/* Status Selection */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-3">סטטוס השיעור</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setStatus('completed'); setHasChanges(true); setSaved(false); }}
              className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${
                status === 'completed'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 text-gray-600'
              }`}
            >
              <CheckCircle2 size={28} />
              <span className="font-medium">הושלם</span>
            </button>
            <button
              onClick={() => { setStatus('cancelled'); setHasChanges(true); setSaved(false); }}
              className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${
                status === 'cancelled'
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-200 text-gray-600'
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
            onChange={(e) => { setTopic(e.target.value); setHasChanges(true); setSaved(false); }}
            placeholder="לדוגמה: לולאות ותנאים, פרויקט משחק..."
            className="w-full p-4 rounded-2xl border border-gray-200 text-lg focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none"
          />
        </div>

        {/* Attendance Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Users size={16} />
              נוכחות
            </h2>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-green-600">{attendance.filter(a => a.status === 'present').length} נוכחים</span>
              <span className="text-gray-300">|</span>
              <span className="text-gray-500">{attendance.length} סה"כ</span>
            </div>
          </div>

          {attendance.length > 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {attendance.map((record) => (
                <div
                  key={record.registrationId}
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
                      onClick={() => handleAttendanceChange(record.registrationId, 'present')}
                      className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                        record.status === 'present'
                          ? 'bg-green-500 text-white shadow-lg shadow-green-200'
                          : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      <Check size={24} />
                    </button>
                    <button
                      onClick={() => handleAttendanceChange(record.registrationId, 'absent')}
                      className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                        record.status === 'absent'
                          ? 'bg-red-500 text-white shadow-lg shadow-red-200'
                          : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      <UserMinus size={24} />
                    </button>
                    <button
                      onClick={() => handleAttendanceChange(record.registrationId, 'late')}
                      className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                        record.status === 'late'
                          ? 'bg-amber-500 text-white shadow-lg shadow-amber-200'
                          : 'bg-gray-100 text-gray-400'
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

        {/* Success Message */}
        {saved && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center text-green-700">
            ✅ נשמר בהצלחה!
          </div>
        )}
      </div>

      {/* Fixed Save Button */}
      {hasChanges && (
        <div className="fixed bottom-4 left-4 right-4 max-w-lg mx-auto z-40">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-medium text-lg shadow-lg shadow-blue-200 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            {saving ? (
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
