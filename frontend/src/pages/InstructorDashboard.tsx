import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Calendar, Clock, Users, CheckCircle, XCircle, AlertCircle, Video, ChevronLeft, BookOpen, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useMeetings, useUpdateMeeting, useCycles } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import Modal from '../components/ui/Modal';
import { CourseMaterials } from '../components/CourseMaterials';
import { meetingStatusHebrew, dayOfWeekHebrew, cycleStatusHebrew } from '../types';
import type { Meeting, MeetingStatus } from '../types';

export default function InstructorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [materialsCourse, setMaterialsCourse] = useState<{ id: string; name: string } | null>(null);
  const [viewMode, setViewMode] = useState<'today' | 'week' | 'past' | 'all'>('today');
  const [cycleFilter, setCycleFilter] = useState<string>('all');

  // Get date range based on view mode
  const dateRange = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    if (viewMode === 'today') {
      return { date: todayStr };
    } else if (viewMode === 'week') {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      return { from: todayStr, to: nextWeek.toISOString().split('T')[0] };
    } else if (viewMode === 'past') {
      const past30 = new Date(today);
      past30.setDate(past30.getDate() - 30);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { from: past30.toISOString().split('T')[0], to: yesterday.toISOString().split('T')[0] };
    }
    return {};
  }, [viewMode]);

  // Pass higher limit for 'all' view to avoid missing future meetings
  const meetingsParams = useMemo(() => ({
    ...dateRange,
    ...(viewMode === 'all' ? { limit: 500 } : {}),
  }), [dateRange, viewMode]);

  const { data: meetings, isLoading } = useMeetings(meetingsParams);
  const updateMeeting = useUpdateMeeting();

  // Fetch ALL instructor cycles independently (so DDL is always complete)
  const { data: allCyclesData } = useCycles({ limit: 200 });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const thisYear = new Date().getFullYear();
    const meetingYear = date.getFullYear();
    return date.toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      // Show year only when it's not the current year (prevents confusion with past cycles)
      ...(meetingYear !== thisYear ? { year: 'numeric' } : {}),
    });
  };

  const formatTime = (time: string) => {
    if (time.includes('T')) {
      // Extract UTC time directly without timezone conversion
      const date = new Date(time);
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    return time.substring(0, 5);
  };

  const isToday = (dateStr: string) => {
    const today = new Date().toISOString().split('T')[0];
    return dateStr.split('T')[0] === today;
  };

  const handleUpdateMeeting = async (meetingId: string, status: MeetingStatus, topic?: string) => {
    try {
      await updateMeeting.mutateAsync({
        id: meetingId,
        data: { status, topic },
      });
      setSelectedMeeting(null);
    } catch (error) {
      console.error('Failed to update meeting:', error);
      alert('שגיאה בעדכון הפגישה');
    }
  };

  const getStatusIcon = (status: MeetingStatus) => {
    switch (status) {
      case 'completed': return <CheckCircle className="text-green-500" size={20} />;
      case 'cancelled': return <XCircle className="text-red-500" size={20} />;
      case 'postponed': return <AlertCircle className="text-yellow-500" size={20} />;
      default: return <Clock className="text-blue-500" size={20} />;
    }
  };

  // Use independently-fetched cycles for the DDL (not derived from loaded meetings)
  // This ensures the active cycle always appears even if its meetings are beyond the pagination limit
  const cycles = useMemo(() => {
    if (allCyclesData && Array.isArray(allCyclesData) && allCyclesData.length > 0) {
      return allCyclesData.map((c: any) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        totalMeetings: c.totalMeetings ?? null,
      }));
    }
    // Fallback: derive from loaded meetings (legacy behavior)
    if (!meetings || !Array.isArray(meetings)) return [];
    const seen = new Map<string, string>();
    meetings.forEach(m => {
      if (m.cycle?.id && m.cycle?.name && !seen.has(m.cycle.id)) {
        seen.set(m.cycle.id, m.cycle.name);
      }
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name, status: undefined, totalMeetings: null }));
  }, [allCyclesData, meetings]);

  // Filter meetings by cycle
  const filteredMeetings = useMemo(() => {
    if (!meetings || !Array.isArray(meetings)) return [];
    if (cycleFilter === 'all') return meetings;
    return meetings.filter(m => m.cycle?.id === cycleFilter);
  }, [meetings, cycleFilter]);

  const stats = useMemo(() => {
    // When a specific cycle is selected, "total" = cycle's configured totalMeetings (not the DB count)
    const selectedCycle = cycleFilter !== 'all' ? cycles.find(c => c.id === cycleFilter) : null;
    const total = selectedCycle?.totalMeetings ?? filteredMeetings.length;
    return {
      total,
      completed: filteredMeetings.filter(m => m.status === 'completed').length,
      pending: filteredMeetings.filter(m => m.status === 'scheduled').length,
    };
  }, [filteredMeetings, cycleFilter, cycles]);

  if (isLoading) {
    return <Loading size="lg" text="טוען פגישות..." />;
  }

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader
        title={`שלום, ${user?.name || 'מדריך'}`}
        subtitle="הפגישות שלך"
        actions={
          <div className="flex gap-2">
            <Link to="/instructor/ai" className="btn btn-primary flex items-center gap-2 text-sm bg-gradient-to-l from-purple-600 to-blue-600 border-0">
              <Sparkles size={16} />
              סוכן AI
            </Link>
            <Link to="/instructor/library" className="btn btn-secondary flex items-center gap-2 text-sm">
              <BookOpen size={16} />
              ספריה
            </Link>
          </div>
        }
      />

      <div className="flex-1 p-6 overflow-auto bg-gray-50">
        {/* View Mode Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setViewMode('today')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'today' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            היום
          </button>
          <button
            onClick={() => setViewMode('week')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'week' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            השבוע הקרוב
          </button>
          <button
            onClick={() => setViewMode('past')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'past' ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            עבר (30 יום)
          </button>
          <button
            onClick={() => setViewMode('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            כל הפגישות
          </button>
        </div>

        {/* Cycle Filter */}
        {cycles.length > 1 && (
          <div className="mb-4">
            <select
              value={cycleFilter}
              onChange={(e) => {
                setCycleFilter(e.target.value);
                // Auto-switch to "all" view so all cycle meetings are visible
                if (e.target.value !== 'all') setViewMode('all');
              }}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium"
            >
              <option value="all">כל המחזורים</option>
              {cycles.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.status ? ` (${cycleStatusHebrew[c.status as keyof typeof cycleStatusHebrew] ?? c.status})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 shadow">
            <div className="flex items-center gap-3">
              <Calendar className="text-blue-500" size={24} />
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-sm text-gray-500">סה"כ פגישות</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg p-4 shadow">
            <div className="flex items-center gap-3">
              <CheckCircle className="text-green-500" size={24} />
              <div>
                <p className="text-2xl font-bold">{stats.completed}</p>
                <p className="text-sm text-gray-500">הושלמו</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg p-4 shadow">
            <div className="flex items-center gap-3">
              <Clock className="text-yellow-500" size={24} />
              <div>
                <p className="text-2xl font-bold">{stats.pending}</p>
                <p className="text-sm text-gray-500">ממתינות</p>
              </div>
            </div>
          </div>
        </div>

        {/* Meetings List */}
        {filteredMeetings && filteredMeetings.length > 0 ? (
          <div className="space-y-3">
            {filteredMeetings.map((meeting) => (
              <div
                key={meeting.id}
                onClick={() => navigate(`/instructor/meeting/${meeting.id}`)}
                className={`bg-white rounded-lg p-4 shadow cursor-pointer hover:shadow-md transition-shadow ${
                  isToday(meeting.scheduledDate) ? 'border-r-4 border-blue-500' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {getStatusIcon(meeting.status)}
                    <div>
                      <p className="font-medium">{meeting.cycle?.name || 'מחזור'}</p>
                      <p className="text-sm text-gray-500">
                        {formatDate(meeting.scheduledDate)} • {formatTime(meeting.startTime)} - {formatTime(meeting.endTime)}
                      </p>
                      <p className="text-sm text-gray-500">
                        {meeting.cycle?.branch?.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`badge ${
                      meeting.status === 'completed' ? 'badge-success' :
                      meeting.status === 'cancelled' ? 'badge-danger' :
                      meeting.status === 'postponed' ? 'badge-warning' : 'badge-info'
                    }`}>
                      {meetingStatusHebrew[meeting.status]}
                    </span>
                    {meeting.cycle?.course?.materialsFolderId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setMaterialsCourse({ id: meeting.cycle!.course!.id, name: meeting.cycle!.course!.name }); }}
                        className="btn btn-secondary text-sm flex items-center gap-1"
                        title="חומרי לימוד"
                      >
                        <BookOpen size={14} />
                        חומרים
                      </button>
                    )}
                    {viewMode !== 'past' && meeting.cycle?.activityType === 'online' && meeting.zoomJoinUrl && meeting.status === 'scheduled' && (
                      <a
                        href={meeting.zoomJoinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary text-sm flex items-center gap-2"
                      >
                        <Video size={16} />
                        הצטרף לזום
                      </a>
                    )}
                    {isToday(meeting.scheduledDate) && meeting.status === 'scheduled' && (
                      <button
                        onClick={() => setSelectedMeeting(meeting)}
                        className="btn btn-secondary text-sm"
                      >
                        עדכן סטטוס
                      </button>
                    )}
                  </div>
                </div>
                {meeting.topic && (
                  <p className="mt-2 text-sm text-gray-600 border-t pt-2">
                    נושא: {meeting.topic}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-lg p-8 text-center">
            <Calendar size={48} className="mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500">
              {viewMode === 'today' ? 'אין פגישות להיום' :
               viewMode === 'past' ? 'אין פגישות ב-30 הימים האחרונים' :
               'אין פגישות בטווח הנבחר'}
            </p>
          </div>
        )}
      </div>

      {/* Update Meeting Modal */}
      <Modal
        isOpen={!!selectedMeeting}
        onClose={() => setSelectedMeeting(null)}
        title="עדכון פגישה"
      >
        {selectedMeeting && (
          <MeetingUpdateForm
            meeting={selectedMeeting}
            onUpdate={handleUpdateMeeting}
            onCancel={() => setSelectedMeeting(null)}
            isLoading={updateMeeting.isPending}
          />
        )}
      </Modal>

      {/* Course Materials Modal */}
      <Modal
        isOpen={!!materialsCourse}
        onClose={() => setMaterialsCourse(null)}
        title={`📚 חומרי לימוד — ${materialsCourse?.name}`}
      >
        {materialsCourse && (
          <div className="p-4">
            <CourseMaterials courseId={materialsCourse.id} courseName={materialsCourse.name} />
          </div>
        )}
      </Modal>
    </div>
  );
}

// Meeting Update Form for Instructor
interface MeetingUpdateFormProps {
  meeting: Meeting;
  onUpdate: (id: string, status: MeetingStatus, topic?: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function MeetingUpdateForm({ meeting, onUpdate, onCancel, isLoading }: MeetingUpdateFormProps) {
  const [status, setStatus] = useState<MeetingStatus>(meeting.status);
  const [topic, setTopic] = useState(meeting.topic || '');

  return (
    <div className="p-6 space-y-4">
      <div>
        <p className="font-medium mb-2">{meeting.cycle?.name}</p>
        <p className="text-sm text-gray-500">
          {new Date(meeting.scheduledDate).toLocaleDateString('he-IL', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
      </div>

      <div>
        <label className="form-label">סטטוס</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setStatus('completed')}
            className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 transition-colors ${
              status === 'completed' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <CheckCircle size={20} />
            הושלם
          </button>
          <button
            type="button"
            onClick={() => setStatus('cancelled')}
            className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 transition-colors ${
              status === 'cancelled' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <XCircle size={20} />
            בוטל
          </button>
        </div>
      </div>

      <div>
        <label className="form-label">נושא השיעור</label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="form-input"
          placeholder="מה לימדת היום?"
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button
          onClick={() => onUpdate(meeting.id, status, topic)}
          className="btn btn-primary"
          disabled={isLoading}
        >
          {isLoading ? 'שומר...' : 'שמור'}
        </button>
      </div>
    </div>
  );
}
