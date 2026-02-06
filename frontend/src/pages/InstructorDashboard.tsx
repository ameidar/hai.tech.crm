import { useState, useMemo } from 'react';
import { Calendar, Clock, Users, CheckCircle, XCircle, AlertCircle, Video } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useMeetings, useUpdateMeeting } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import Modal from '../components/ui/Modal';
import { meetingStatusHebrew, dayOfWeekHebrew } from '../types';
import type { Meeting, MeetingStatus } from '../types';

export default function InstructorDashboard() {
  const { user } = useAuth();
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [viewMode, setViewMode] = useState<'today' | 'week' | 'all'>('today');

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
    }
    return {};
  }, [viewMode]);

  const { data: meetings, isLoading } = useMeetings(dateRange);
  const updateMeeting = useUpdateMeeting();

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
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

  const stats = useMemo(() => {
    if (!meetings || !Array.isArray(meetings)) return { total: 0, completed: 0, pending: 0 };
    return {
      total: meetings.length,
      completed: meetings.filter(m => m.status === 'completed').length,
      pending: meetings.filter(m => m.status === 'scheduled').length,
    };
  }, [meetings]);

  if (isLoading) {
    return <Loading size="lg" text="טוען פגישות..." />;
  }

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader
        title={`שלום, ${user?.name || 'מדריך'}`}
        subtitle="הפגישות שלך"
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
            onClick={() => setViewMode('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            כל הפגישות
          </button>
        </div>

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
        {meetings && meetings.length > 0 ? (
          <div className="space-y-3">
            {meetings.map((meeting) => (
              <div
                key={meeting.id}
                className={`bg-white rounded-lg p-4 shadow ${
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
                    {meeting.cycle?.activityType === 'online' && meeting.zoomJoinUrl && meeting.status === 'scheduled' && (
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
            <p className="text-gray-500">אין פגישות {viewMode === 'today' ? 'להיום' : 'בטווח הנבחר'}</p>
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
