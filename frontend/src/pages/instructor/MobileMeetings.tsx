import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Calendar, 
  Clock, 
  MapPin, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  ChevronLeft,
  Users,
  Video,
  Building2
} from 'lucide-react';
import { useMeetings } from '../../hooks/useApi';
import Loading from '../../components/ui/Loading';
import { meetingStatusHebrew } from '../../types';
import type { Meeting, MeetingStatus } from '../../types';

/**
 * Mobile-optimized meetings list for instructors
 * Focus on today's meetings with easy access to actions
 */
export default function MobileMeetings() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'today' | 'week'>('today');

  // Get date range based on view mode
  const dateRange = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    if (viewMode === 'today') {
      return { date: todayStr };
    } else {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      return { from: todayStr, to: nextWeek.toISOString().split('T')[0] };
    }
  }, [viewMode]);

  const { data: meetings, isLoading } = useMeetings(dateRange);

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
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };

  const isToday = (dateStr: string) => {
    const today = new Date().toISOString().split('T')[0];
    return dateStr.split('T')[0] === today;
  };

  const getStatusConfig = (status: MeetingStatus) => {
    switch (status) {
      case 'completed':
        return { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200' };
      case 'cancelled':
        return { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200' };
      case 'postponed':
        return { icon: AlertCircle, color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-200' };
      default:
        return { icon: Clock, color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200' };
    }
  };

  const stats = useMemo(() => {
    if (!meetings || !Array.isArray(meetings)) return { total: 0, completed: 0, pending: 0 };
    return {
      total: meetings.length,
      completed: meetings.filter(m => m.status === 'completed').length,
      pending: meetings.filter(m => m.status === 'scheduled').length,
    };
  }, [meetings]);

  // Group meetings by date
  const groupedMeetings = useMemo(() => {
    if (!meetings || !Array.isArray(meetings)) return {};
    return meetings.reduce((acc, meeting) => {
      const date = meeting.scheduledDate.split('T')[0];
      if (!acc[date]) acc[date] = [];
      acc[date].push(meeting);
      return acc;
    }, {} as Record<string, Meeting[]>);
  }, [meetings]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loading size="lg" text="טוען פגישות..." />
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* View Mode Toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setViewMode('today')}
          className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all ${
            viewMode === 'today' 
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' 
              : 'bg-white text-gray-600 border border-gray-200'
          }`}
        >
          היום
        </button>
        <button
          onClick={() => setViewMode('week')}
          className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all ${
            viewMode === 'week' 
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' 
              : 'bg-white text-gray-600 border border-gray-200'
          }`}
        >
          השבוע
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <div className="text-2xl font-bold text-gray-800">{stats.total}</div>
          <div className="text-xs text-gray-500">פגישות</div>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
          <div className="text-xs text-gray-500">הושלמו</div>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <div className="text-2xl font-bold text-blue-600">{stats.pending}</div>
          <div className="text-xs text-gray-500">ממתינות</div>
        </div>
      </div>

      {/* Meetings List */}
      {Object.keys(groupedMeetings).length > 0 ? (
        <div className="space-y-6">
          {Object.entries(groupedMeetings).map(([date, dateMeetings]) => (
            <div key={date}>
              {/* Date Header */}
              {viewMode === 'week' && (
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-2 h-2 rounded-full ${isToday(date) ? 'bg-blue-500' : 'bg-gray-300'}`} />
                  <span className={`text-sm font-medium ${isToday(date) ? 'text-blue-600' : 'text-gray-500'}`}>
                    {isToday(date) ? 'היום' : formatDate(date)}
                  </span>
                </div>
              )}
              
              {/* Meetings for this date */}
              <div className="space-y-3">
                {dateMeetings.map((meeting) => {
                  const statusConfig = getStatusConfig(meeting.status);
                  const StatusIcon = statusConfig.icon;
                  const isOnline = meeting.cycle?.activityType === 'online';
                  
                  return (
                    <button
                      key={meeting.id}
                      onClick={() => navigate(`/instructor/meeting/${meeting.id}`)}
                      className={`w-full bg-white rounded-2xl p-4 shadow-sm border ${
                        isToday(meeting.scheduledDate) && meeting.status === 'scheduled'
                          ? 'border-blue-300 shadow-blue-100'
                          : 'border-gray-100'
                      } text-right transition-all active:scale-[0.98]`}
                    >
                      {/* Top Row - Time & Status */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Clock size={16} className="text-gray-400" />
                          <span className="text-lg font-semibold">
                            {formatTime(meeting.startTime)}
                          </span>
                          <span className="text-gray-400">-</span>
                          <span className="text-gray-500">
                            {formatTime(meeting.endTime)}
                          </span>
                        </div>
                        <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusConfig.bg} ${statusConfig.color}`}>
                          <StatusIcon size={14} />
                          {meetingStatusHebrew[meeting.status]}
                        </div>
                      </div>

                      {/* Cycle Name */}
                      <h3 className="font-medium text-gray-800 mb-2">
                        {meeting.cycle?.name || 'פגישה'}
                      </h3>

                      {/* Location & Type */}
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          {isOnline ? (
                            <>
                              <Video size={14} />
                              <span>אונליין</span>
                            </>
                          ) : (
                            <>
                              <Building2 size={14} />
                              <span>{meeting.cycle?.branch?.name || 'סניף'}</span>
                            </>
                          )}
                        </div>
                        {meeting.cycle?._count?.registrations !== undefined && (
                          <div className="flex items-center gap-1">
                            <Users size={14} />
                            <span>{meeting.cycle._count.registrations} תלמידים</span>
                          </div>
                        )}
                      </div>

                      {/* Topic (if exists) */}
                      {meeting.topic && (
                        <div className="mt-2 pt-2 border-t border-gray-100 text-sm text-gray-600">
                          📝 {meeting.topic}
                        </div>
                      )}

                      {/* Action Hint */}
                      {isToday(meeting.scheduledDate) && meeting.status === 'scheduled' && (
                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-xs text-blue-600 font-medium">
                            לחץ לעדכון נוכחות וסטטוס
                          </span>
                          <ChevronLeft size={16} className="text-blue-400" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-8 text-center">
          <Calendar size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 text-lg">
            אין פגישות {viewMode === 'today' ? 'להיום' : 'השבוע'}
          </p>
          <p className="text-gray-400 text-sm mt-1">
            תהנה מהמנוחה! 🎉
          </p>
        </div>
      )}
    </div>
  );
}
