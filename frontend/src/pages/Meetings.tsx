import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { useMeetings, useRecalculateMeeting, useViewData } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import MeetingDetailModal from '../components/MeetingDetailModal';
import ViewSelector from '../components/ViewSelector';
import { meetingStatusHebrew } from '../types';
import type { Meeting, MeetingStatus } from '../types';

export default function Meetings() {
  const [selectedDate, setSelectedDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'date' | 'view'>('date');

  const { data: meetings, isLoading } = useMeetings({ date: selectedDate });
  
  // Build date filter for view data - filter by selectedDate
  const dateFilter = useMemo(() => {
    const date = new Date(selectedDate);
    date.setHours(0, 0, 0, 0);
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    return [
      { field: 'scheduledDate', operator: 'gte', value: date.toISOString() },
      { field: 'scheduledDate', operator: 'lt', value: nextDay.toISOString() },
    ];
  }, [selectedDate]);
  
  const { data: viewData, isLoading: viewLoading } = useViewData(activeViewId, dateFilter);
  const recalculateMeeting = useRecalculateMeeting();

  // Determine which data to display based on view mode
  const displayMeetings = viewMode === 'view' && viewData?.data 
    ? viewData.data as Meeting[]
    : meetings || [];
  const displayLoading = viewMode === 'view' ? viewLoading : isLoading;

  const handleApplyView = (filters: any[], columns: string[], sortBy?: string, sortOrder?: string) => {
    // This is called when a view is selected from ViewSelector
    // The actual data fetching happens through useViewData
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const formatTime = (time: string) => {
    if (!time) return '--:--';
    if (time.includes('T')) {
      const date = new Date(time);
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    return time.substring(0, 5);
  };

  const changeDate = (days: number) => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + days);
    setSelectedDate(date.toISOString().split('T')[0]);
  };

  const getStatusBadgeClass = (status: MeetingStatus) => {
    switch (status) {
      case 'completed':
        return 'badge-success';
      case 'cancelled':
        return 'badge-danger';
      case 'postponed':
        return 'badge-warning';
      default:
        return 'badge-info';
    }
  };

  const handleRecalculate = async (meetingId: string) => {
    try {
      const result = await recalculateMeeting.mutateAsync(meetingId);
      if (selectedMeeting) {
        setSelectedMeeting({ ...selectedMeeting, ...result });
      }
    } catch (error) {
      console.error('Failed to recalculate meeting:', error);
      alert('שגיאה בחישוב מחדש');
    }
  };

  const stats = displayMeetings.length > 0
    ? {
        total: displayMeetings.length,
        completed: displayMeetings.filter((m) => m.status === 'completed').length,
        pending: displayMeetings.filter((m) => m.status === 'scheduled').length,
        cancelled: displayMeetings.filter((m) => m.status === 'cancelled').length,
      }
    : null;

  return (
    <>
      <PageHeader
        title="פגישות"
        subtitle={formatDate(selectedDate)}
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Date Navigation */}
        <div className="mb-6 flex items-center gap-4">
          <div className="flex items-center gap-2 bg-white rounded-lg border p-1">
            <button
              onClick={() => changeDate(-1)}
              className="p-2 rounded hover:bg-gray-100 transition-colors"
            >
              <ChevronRight size={20} />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border-0 focus:ring-0"
            />
            <button
              onClick={() => changeDate(1)}
              className="p-2 rounded hover:bg-gray-100 transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
          </div>

          <button
            onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
            className="btn btn-secondary"
          >
            היום
          </button>

          {/* View Selector */}
          <div className="me-auto">
            <ViewSelector
              entity="meetings"
              onApplyView={handleApplyView}
              onViewSelect={(viewId) => {
                setActiveViewId(viewId);
                if (viewId) {
                  setViewMode('view');
                } else {
                  setViewMode('date');
                }
              }}
            />
          </div>

          {stats && stats.total > 0 && (
            <div className="flex items-center gap-4 ms-auto text-sm">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {stats.completed} הושלמו
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                {stats.pending} ממתינים
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {stats.cancelled} בוטלו
              </span>
            </div>
          )}
        </div>

        {/* Meetings List */}
        {displayLoading ? (
          <Loading size="lg" text="טוען פגישות..." />
        ) : displayMeetings && displayMeetings.length > 0 ? (
          <div className="card overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>שעה</th>
                  <th>מחזור</th>
                  <th>קורס</th>
                  <th>סניף</th>
                  <th>מדריך</th>
                  <th>סטטוס</th>
                  <th>הכנסה</th>
                  <th>עלות</th>
                  <th>רווח</th>
                </tr>
              </thead>
              <tbody>
                {displayMeetings
                  .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
                  .map((meeting) => (
                    <tr 
                      key={meeting.id}
                      onClick={() => setSelectedMeeting(meeting)}
                      className="cursor-pointer hover:bg-blue-50 transition-colors"
                    >
                      <td className="font-medium">
                        {formatTime(meeting.startTime)} - {formatTime(meeting.endTime)}
                      </td>
                      <td>
                        <Link
                          to={`/cycles/${meeting.cycleId}`}
                          className="text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {meeting.cycle?.name || '-'}
                        </Link>
                      </td>
                      <td>{meeting.cycle?.course?.name || '-'}</td>
                      <td>{meeting.cycle?.branch?.name || '-'}</td>
                      <td>{meeting.instructor?.name || '-'}</td>
                      <td>
                        <span className={`badge ${getStatusBadgeClass(meeting.status)}`}>
                          {meetingStatusHebrew[meeting.status]}
                        </span>
                      </td>
                      <td className="text-green-600">
                        {meeting.status === 'completed' ? (meeting.revenue || 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 }) : '-'}
                      </td>
                      <td className="text-red-600">
                        {meeting.status === 'completed' ? (meeting.instructorPayment || 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 }) : '-'}
                      </td>
                      <td className={meeting.profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {meeting.status === 'completed' ? (meeting.profit || 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 }) : '-'}
                      </td>
                    </tr>
                  ))}
              </tbody>
              {displayMeetings && displayMeetings.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 font-medium">
                    <td colSpan={6} className="text-start">סה"כ</td>
                    <td className="text-green-600">
                      {displayMeetings
                        .filter((m) => m.status === 'completed')
                        .reduce((sum, m) => sum + Number(m.revenue || 0), 0)
                        .toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 })}
                    </td>
                    <td className="text-red-600">
                      {displayMeetings
                        .filter((m) => m.status === 'completed')
                        .reduce((sum, m) => sum + Number(m.instructorPayment || 0), 0)
                        .toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 })}
                    </td>
                    <td className="text-green-600">
                      {displayMeetings
                        .filter((m) => m.status === 'completed')
                        .reduce((sum, m) => sum + Number(m.profit || 0), 0)
                        .toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 })}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Calendar size={64} />}
            title="אין פגישות"
            description={`אין פגישות מתוכננות ל${formatDate(selectedDate)}`}
          />
        )}
      </div>

      {/* Meeting Detail Modal */}
      <MeetingDetailModal
        meeting={selectedMeeting}
        onClose={() => setSelectedMeeting(null)}
        onRecalculate={handleRecalculate}
        isRecalculating={recalculateMeeting.isPending}
      />
    </>
  );
}
