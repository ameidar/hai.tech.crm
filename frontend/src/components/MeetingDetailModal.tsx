import { Link } from 'react-router-dom';
import { RefreshCw, Info } from 'lucide-react';
import Modal from './ui/Modal';
import { meetingStatusHebrew, cycleTypeHebrew, activityTypeHebrew } from '../types';
import type { Meeting, MeetingStatus } from '../types';

interface MeetingDetailModalProps {
  meeting: Meeting | null;
  onClose: () => void;
  onRecalculate: (meetingId: string) => Promise<void>;
  isRecalculating: boolean;
}

export default function MeetingDetailModal({ 
  meeting, 
  onClose, 
  onRecalculate,
  isRecalculating,
}: MeetingDetailModalProps) {
  if (!meeting) return null;

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

  const formatCurrency = (amount: number | null | undefined) => {
    return (amount || 0).toLocaleString('he-IL', { 
      style: 'currency', 
      currency: 'ILS', 
      minimumFractionDigits: 0 
    });
  };

  const formatDateFull = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
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

  const handleRecalculate = async () => {
    await onRecalculate(meeting.id);
  };

  return (
    <Modal
      isOpen={!!meeting}
      onClose={onClose}
      title="פרטי פגישה"
      size="lg"
    >
      <div className="p-6 space-y-6">
        {/* Header Info */}
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {meeting.cycle?.name || 'פגישה'}
            </h3>
            <p className="text-gray-500">
              {formatDateFull(meeting.scheduledDate)} • {formatTime(meeting.startTime)} - {formatTime(meeting.endTime)}
            </p>
          </div>
          <span className={`badge ${getStatusBadgeClass(meeting.status)}`}>
            {meetingStatusHebrew[meeting.status]}
          </span>
        </div>

        {/* General Details */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
          <div>
            <span className="text-sm text-gray-500">קורס</span>
            <p className="font-medium">{meeting.cycle?.course?.name || '-'}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">סניף</span>
            <p className="font-medium">{meeting.cycle?.branch?.name || '-'}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">מדריך</span>
            <p className="font-medium">{meeting.instructor?.name || '-'}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">סוג מחזור</span>
            <p className="font-medium">{meeting.cycle?.type ? cycleTypeHebrew[meeting.cycle.type] : '-'}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">סוג פעילות</span>
            <p className="font-medium">{meeting.activityType ? activityTypeHebrew[meeting.activityType] : (meeting.cycle?.activityType ? activityTypeHebrew[meeting.cycle.activityType] : '-')}</p>
          </div>
          {meeting.topic && (
            <div className="col-span-2">
              <span className="text-sm text-gray-500">נושא</span>
              <p className="font-medium">{meeting.topic}</p>
            </div>
          )}
          {meeting.notes && (
            <div className="col-span-2">
              <span className="text-sm text-gray-500">הערות</span>
              <p className="font-medium">{meeting.notes}</p>
            </div>
          )}
        </div>

        {/* Financial Details */}
        <div className="border-t pt-4">
          <div className="flex justify-between items-center mb-4">
            <h4 className="font-semibold text-gray-900 flex items-center gap-2">
              <Info size={18} />
              פרטים כספיים
            </h4>
            {meeting.status === 'completed' && (
              <button
                onClick={handleRecalculate}
                disabled={isRecalculating}
                className="btn btn-secondary btn-sm flex items-center gap-2"
              >
                <RefreshCw size={16} className={isRecalculating ? 'animate-spin' : ''} />
                {isRecalculating ? 'מחשב...' : 'חשב מחדש'}
              </button>
            )}
          </div>

          {meeting.status === 'completed' ? (
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-green-50 rounded-lg text-center">
                <span className="text-sm text-green-700">הכנסה</span>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(meeting.revenue)}</p>
              </div>
              <div className="p-4 bg-red-50 rounded-lg text-center">
                <span className="text-sm text-red-700">עלות מדריך</span>
                <p className="text-2xl font-bold text-red-600">{formatCurrency(meeting.instructorPayment)}</p>
              </div>
              <div className={`p-4 rounded-lg text-center ${(meeting.profit || 0) >= 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
                <span className={`text-sm ${(meeting.profit || 0) >= 0 ? 'text-blue-700' : 'text-red-700'}`}>רווח</span>
                <p className={`text-2xl font-bold ${(meeting.profit || 0) >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {formatCurrency(meeting.profit)}
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>נתונים כספיים יחושבו לאחר השלמת הפגישה</p>
            </div>
          )}

          {/* Calculation Details */}
          {meeting.status === 'completed' && meeting.cycle && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg text-sm">
              <h5 className="font-medium text-gray-700 mb-2">פירוט החישוב:</h5>
              <div className="space-y-1 text-gray-600">
                {meeting.cycle.type === 'private' && (
                  <>
                    <p>• סוג: פרטי - חישוב לפי הרשמות</p>
                    <p>• מחיר מחזור: {formatCurrency(meeting.cycle.pricePerStudent)} לתלמיד</p>
                    <p>• מספר מפגשים: {meeting.cycle.totalMeetings}</p>
                  </>
                )}
                {meeting.cycle.type === 'institutional_per_child' && (
                  <>
                    <p>• סוג: מוסדי (פר ילד)</p>
                    <p>• מחיר למפגש לילד: {formatCurrency(meeting.cycle.pricePerStudent)}</p>
                    <p>• מספר תלמידים: {meeting.cycle.studentCount || '-'}</p>
                  </>
                )}
                {meeting.cycle.type === 'institutional_fixed' && (
                  <>
                    <p>• סוג: מוסדי (סכום קבוע)</p>
                    <p>• הכנסה קבועה למפגש: {formatCurrency(meeting.cycle.meetingRevenue)}</p>
                  </>
                )}
                <p className="border-t pt-1 mt-2">
                  • עלות מדריך: לפי תעריף {meeting.activityType === 'online' ? 'אונליין' : meeting.activityType === 'private_lesson' ? 'פרטי' : 'פרונטלי'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Cycle Link */}
        <div className="border-t pt-4 flex justify-end">
          <Link
            to={`/cycles/${meeting.cycleId}`}
            className="btn btn-primary"
            onClick={onClose}
          >
            מעבר למחזור
          </Link>
        </div>
      </div>
    </Modal>
  );
}
