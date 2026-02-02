import { useState } from 'react';
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
import { useMeetings, useRecalculateMeeting } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import MeetingDetailModal from '../components/MeetingDetailModal';
import { meetingStatusHebrew } from '../types';
import type { Meeting, MeetingStatus } from '../types';

export default function Meetings() {
  const [selectedDate, setSelectedDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

  const { data: meetings, isLoading } = useMeetings({ date: selectedDate });
  const recalculateMeeting = useRecalculateMeeting();

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

  const stats = meetings
    ? {
        total: meetings.length,
        completed: meetings.filter((m) => m.status === 'completed').length,
        pending: meetings.filter((m) => m.status === 'scheduled').length,
        cancelled: meetings.filter((m) => m.status === 'cancelled').length,
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
        {isLoading ? (
          <Loading size="lg" text="טוען פגישות..." />
        ) : meetings && meetings.length > 0 ? (
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
                {meetings
                  .sort((a, b) => a.startTime.localeCompare(b.startTime))
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
              {stats && stats.total > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 font-medium">
                    <td colSpan={6} className="text-start">סה"כ</td>
                    <td className="text-green-600">
                      {meetings
                        .filter((m) => m.status === 'completed')
                        .reduce((sum, m) => sum + Number(m.revenue || 0), 0)
                        .toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 })}
                    </td>
                    <td className="text-red-600">
                      {meetings
                        .filter((m) => m.status === 'completed')
                        .reduce((sum, m) => sum + Number(m.instructorPayment || 0), 0)
                        .toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 })}
                    </td>
                    <td className="text-green-600">
                      {meetings
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
