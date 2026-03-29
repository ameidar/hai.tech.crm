import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Calendar, 
  Clock, 
  CheckCircle2, 
  Users,
  ChevronLeft
} from 'lucide-react';
import { useMeetings } from '../../hooks/useApi';
import Loading from '../../components/ui/Loading';
import type { Meeting } from '../../types';

/**
 * Quick attendance overview - shows today's meetings needing attendance
 */
export default function MobileAttendanceOverview() {
  const navigate = useNavigate();
  
  // Get today's meetings
  const today = new Date().toISOString().split('T')[0];
  const { data: meetings, isLoading } = useMeetings({ date: today });

  const formatTime = (time: string) => {
    if (time.includes('T')) {
      const date = new Date(time);
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    return time.substring(0, 5);
  };

  // Filter to only show meetings that need attention
  const pendingMeetings = useMemo(() => {
    if (!meetings || !Array.isArray(meetings)) return [];
    return meetings.filter(m => m.status === 'scheduled' || m.status === 'completed');
  }, [meetings]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loading size="lg" text="טוען..." />
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">נוכחות היום</h1>
        <p className="text-gray-500 text-sm">
          {new Date().toLocaleDateString('he-IL', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
      </div>

      {pendingMeetings.length > 0 ? (
        <div className="space-y-4">
          {pendingMeetings.map((meeting) => (
            <button
              key={meeting.id}
              onClick={() => navigate(`/instructor/meeting/${meeting.id}`)}
              className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-right transition-all active:scale-[0.98]"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock size={16} className="text-gray-400" />
                    <span className="font-semibold">
                      {formatTime(meeting.startTime)}
                    </span>
                  </div>
                  <h3 className="font-medium text-gray-800 mb-2">
                    {meeting.cycle?.name || 'פגישה'}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Users size={14} />
                    <span>
                      {meeting.cycle?._count?.registrations || '?'} תלמידים
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-2">
                  {meeting.status === 'completed' ? (
                    <div className="flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle2 size={16} />
                      <span>הושלם</span>
                    </div>
                  ) : (
                    <div className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-medium">
                      ממתין
                    </div>
                  )}
                  <ChevronLeft size={20} className="text-gray-300" />
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-8 text-center">
          <Calendar size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 text-lg">אין שיעורים היום</p>
          <p className="text-gray-400 text-sm mt-1">כל הנוכחות מולאה! 🎉</p>
        </div>
      )}

      {/* Quick tip */}
      <div className="mt-6 bg-blue-50 rounded-2xl p-4 border border-blue-100">
        <p className="text-blue-800 text-sm">
          💡 <strong>טיפ:</strong> לחץ על כל שיעור כדי למלא נוכחות ולעדכן את נושא השיעור
        </p>
      </div>
    </div>
  );
}
