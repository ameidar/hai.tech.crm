import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertCircle, 
  Loader2,
  Users,
  Calendar,
  MapPin,
  BookOpen
} from 'lucide-react';

interface Meeting {
  id: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  cycle: {
    name: string;
    course: { name: string };
    branch: { name: string };
    registrations: Array<{
      id: string;
      student: { id: string; name: string };
    }>;
  };
  instructor: { id: string; name: string };
  attendance: Array<{
    registrationId: string;
    status: string;
    registration: {
      student: { name: string };
    };
  }>;
}

interface AttendanceRecord {
  registrationId: string;
  status: 'present' | 'absent' | 'late';
  notes?: string;
}

export default function MeetingStatus() {
  const { meetingId, token } = useParams<{ meetingId: string; token: string }>();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  
  const [selectedStatus, setSelectedStatus] = useState<string>('completed');
  const [notes, setNotes] = useState('');
  const [attendance, setAttendance] = useState<Record<string, AttendanceRecord>>({});

  useEffect(() => {
    fetchMeeting();
  }, [meetingId, token]);

  const fetchMeeting = async () => {
    try {
      const response = await fetch(`/api/meeting-status/${meetingId}/${token}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'שגיאה בטעינת הפגישה');
      }
      const data = await response.json();
      setMeeting(data);
      setSelectedStatus(data.status === 'scheduled' ? 'completed' : data.status);
      setNotes(data.notes || '');
      
      // Initialize attendance from existing records
      const initialAttendance: Record<string, AttendanceRecord> = {};
      data.attendance?.forEach((att: any) => {
        initialAttendance[att.registrationId] = {
          registrationId: att.registrationId,
          status: att.status,
        };
      });
      // Add students without attendance as present by default
      data.cycle.registrations.forEach((reg: any) => {
        if (!initialAttendance[reg.id]) {
          initialAttendance[reg.id] = {
            registrationId: reg.id,
            status: 'present',
          };
        }
      });
      setAttendance(initialAttendance);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/meeting-status/${meetingId}/${token}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: selectedStatus,
          notes,
          attendance: Object.values(attendance),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'שגיאה בעדכון הסטטוס');
      }

      setSuccess(true);
      // Refetch to show updated data
      await fetchMeeting();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('he-IL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (timeStr: string) => {
    return new Date(timeStr).toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Loader2 className="animate-spin h-12 w-12 text-blue-600" />
      </div>
    );
  }

  if (error && !meeting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">שגיאה</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">הסטטוס עודכן בהצלחה!</h1>
          <p className="text-gray-600 mb-4">תודה על העדכון</p>
          <button
            onClick={() => setSuccess(false)}
            className="btn btn-secondary"
          >
            חזרה לפגישה
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-lg mx-auto">
        {/* Logo */}
        <div className="text-center mb-6">
          <img src="/logo.png" alt="דרך ההייטק" className="h-16 mx-auto" />
        </div>

        {/* Meeting Info Card */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h1 className="text-xl font-bold text-gray-900 mb-4">עדכון סטטוס פגישה</h1>
          
          <div className="space-y-3 text-gray-600">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-blue-500" />
              <span>{formatDate(meeting!.scheduledDate)}</span>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-blue-500" />
              <span>{formatTime(meeting!.startTime)} - {formatTime(meeting!.endTime)}</span>
            </div>
            <div className="flex items-center gap-3">
              <BookOpen className="h-5 w-5 text-blue-500" />
              <span>{meeting!.cycle.course.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-blue-500" />
              <span>{meeting!.cycle.branch.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-blue-500" />
              <span>{meeting!.cycle.registrations.length} תלמידים</span>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-700 font-medium">{meeting!.cycle.name}</p>
          </div>
        </div>

        {/* Status Selection */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="font-bold text-gray-900 mb-4">סטטוס הפגישה</h2>
          
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setSelectedStatus('completed')}
              className={`p-4 rounded-lg border-2 transition-all ${
                selectedStatus === 'completed'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <CheckCircle className={`h-8 w-8 mx-auto mb-2 ${
                selectedStatus === 'completed' ? 'text-green-500' : 'text-gray-400'
              }`} />
              <span className="text-sm font-medium">בוצע</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedStatus('cancelled')}
              className={`p-4 rounded-lg border-2 transition-all ${
                selectedStatus === 'cancelled'
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <XCircle className={`h-8 w-8 mx-auto mb-2 ${
                selectedStatus === 'cancelled' ? 'text-red-500' : 'text-gray-400'
              }`} />
              <span className="text-sm font-medium">בוטל</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedStatus('no_show')}
              className={`p-4 rounded-lg border-2 transition-all ${
                selectedStatus === 'no_show'
                  ? 'border-orange-500 bg-orange-50 text-orange-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <AlertCircle className={`h-8 w-8 mx-auto mb-2 ${
                selectedStatus === 'no_show' ? 'text-orange-500' : 'text-gray-400'
              }`} />
              <span className="text-sm font-medium">לא הגיעו</span>
            </button>
          </div>
        </div>

        {/* Attendance (only if completed) */}
        {selectedStatus === 'completed' && meeting!.cycle.registrations.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="font-bold text-gray-900 mb-4">נוכחות תלמידים</h2>
            
            <div className="space-y-3">
              {meeting!.cycle.registrations.map((reg) => (
                <div key={reg.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="font-medium">{reg.student.name}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAttendance(prev => ({
                        ...prev,
                        [reg.id]: { registrationId: reg.id, status: 'present' }
                      }))}
                      className={`px-3 py-1 rounded-full text-sm ${
                        attendance[reg.id]?.status === 'present'
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      נוכח
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttendance(prev => ({
                        ...prev,
                        [reg.id]: { registrationId: reg.id, status: 'absent' }
                      }))}
                      className={`px-3 py-1 rounded-full text-sm ${
                        attendance[reg.id]?.status === 'absent'
                          ? 'bg-red-500 text-white'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      חסר
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="font-bold text-gray-900 mb-4">הערות (אופציונלי)</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full border rounded-lg p-3 text-gray-700"
            placeholder="הערות לפגישה..."
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700">
            <AlertCircle size={20} />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="w-full btn btn-primary justify-center py-4 text-lg"
        >
          {saving ? (
            <Loader2 className="animate-spin h-5 w-5" />
          ) : (
            'שמור סטטוס'
          )}
        </button>
      </div>
    </div>
  );
}
