import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Info, Copy, Check, Receipt, Users, MessageSquare, Mail } from 'lucide-react';
import Modal from './ui/Modal';
import MeetingExpenses from './MeetingExpenses';
import SendMessageModal from './SendMessageModal';
import { useMeetingExpenses } from '../hooks/useExpenses';
import { meetingStatusHebrew, cycleTypeHebrew, activityTypeHebrew } from '../types';
import type { Meeting, MeetingStatus } from '../types';

interface MeetingDetailModalProps {
  meeting: Meeting | null;
  onClose: () => void;
  onRecalculate: (meetingId: string) => Promise<void>;
  isRecalculating: boolean;
  isAdmin?: boolean;
}

const rateTypeLabels: Record<string, string> = {
  preparation: 'תומך/הכנת חומרים',
  online: 'אונליין',
  frontal: 'פרונטלי',
};

export default function MeetingDetailModal({ 
  meeting, 
  onClose, 
  onRecalculate,
  isRecalculating,
  isAdmin = false,
}: MeetingDetailModalProps) {
  const [copied, setCopied] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const { data: expenses } = useMeetingExpenses(meeting?.id || '');

  if (!meeting) return null;
  
  // Find extra instructor expenses
  const extraInstructorExpenses = (expenses || []).filter(e => e.type === 'extra_instructor' && e.instructor);
  const totalExpenses = (expenses || []).reduce((sum, e) => e.status !== 'rejected' ? sum + Number(e.amount) : sum, 0);
  
  // Get adjusted profit values from meeting (includes cycle expense share)
  const adjustedProfit = (meeting as any).adjustedProfit;
  const cycleExpenseShare = (meeting as any).cycleExpenseShare || 0;
  const displayProfit = adjustedProfit !== undefined ? adjustedProfit : Number(meeting.profit || 0);

  const copyMeetingId = async () => {
    await navigator.clipboard.writeText(meeting.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
            <div className="flex items-center gap-2">
              <p className="font-medium">{meeting.instructor?.name || '-'}</p>
              {meeting.instructor && (
                <button
                  onClick={() => setShowMessageModal(true)}
                  className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                  title="שלח הודעה למדריך"
                >
                  <MessageSquare size={16} />
                </button>
              )}
            </div>
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
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-green-50 rounded-lg text-center">
                  <span className="text-sm text-green-700">הכנסה</span>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(meeting.revenue)}</p>
                </div>
                <div className="p-4 bg-red-50 rounded-lg text-center">
                  <span className="text-sm text-red-700">עלות מדריך</span>
                  <p className="text-2xl font-bold text-red-600">{formatCurrency(meeting.instructorPayment)}</p>
                </div>
                <div className={`p-4 rounded-lg text-center ${displayProfit >= 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
                  <span className={`text-sm ${displayProfit >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    רווח {cycleExpenseShare > 0 ? '(כולל הוצאות מחזור)' : ''}
                  </span>
                  <p className={`text-2xl font-bold ${displayProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                    {formatCurrency(displayProfit)}
                  </p>
                  {cycleExpenseShare > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      (לפני: {formatCurrency(meeting.profit)}, הוצ' מחזור: {formatCurrency(cycleExpenseShare)})
                    </p>
                  )}
                </div>
              </div>
              
              {/* Extra Instructors Summary */}
              {extraInstructorExpenses.length > 0 && (
                <div className="p-3 bg-orange-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Users size={16} className="text-orange-600" />
                    <span className="font-medium text-orange-800">מדריכים נוספים</span>
                  </div>
                  <div className="space-y-1">
                    {extraInstructorExpenses.map(expense => (
                      <div key={expense.id} className="flex justify-between text-sm">
                        <span className="text-orange-700">
                          {expense.instructor?.name} ({rateTypeLabels[expense.rateType || 'preparation']})
                        </span>
                        <span className="font-medium text-orange-800">{formatCurrency(Number(expense.amount))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Total Expenses Summary */}
              {totalExpenses > 0 && (
                <div className="p-3 bg-gray-100 rounded-lg flex justify-between items-center">
                  <span className="text-gray-600">סה"כ הוצאות נלוות:</span>
                  <span className="font-bold text-gray-800">{formatCurrency(totalExpenses)}</span>
                </div>
              )}
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
                  • עלות מדריך ראשי ({meeting.instructor?.name}): לפי תעריף {meeting.activityType === 'online' ? 'אונליין' : meeting.activityType === 'private_lesson' ? 'פרטי' : 'פרונטלי'}
                </p>
                {extraInstructorExpenses.length > 0 && (
                  <>
                    {extraInstructorExpenses.map(expense => (
                      <p key={expense.id}>
                        • מדריך נוסף ({expense.instructor?.name}): {expense.hours} שעות × תעריף {rateTypeLabels[expense.rateType || 'preparation']}
                        {expense.instructor?.employmentType === 'employee' && ' × 1.3 (עלות מעסיק)'}
                        {' = '}{formatCurrency(Number(expense.amount))}
                      </p>
                    ))}
                  </>
                )}
                {totalExpenses > 0 && (
                  <p className="border-t pt-1 mt-2 font-medium">
                    • סה"כ הוצאות נלוות: {formatCurrency(totalExpenses)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Meeting Expenses */}
        <div className="border-t pt-4">
          <h4 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Receipt size={18} />
            הוצאות נלוות
          </h4>
          <MeetingExpenses 
            meetingId={meeting.id} 
            isAdmin={isAdmin}
            canSubmit={true}
          />
        </div>

        {/* Meeting ID */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between p-3 bg-gray-100 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Meeting ID:</span>
              <code className="text-xs bg-white px-2 py-1 rounded border font-mono">{meeting.id}</code>
            </div>
            <button
              onClick={copyMeetingId}
              className="btn btn-secondary btn-sm flex items-center gap-1"
              title="העתק ID"
            >
              {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              {copied ? 'הועתק!' : 'העתק'}
            </button>
          </div>
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

      {/* Send Message Modal */}
      {showMessageModal && meeting.instructor && (
        <SendMessageModal
          instructor={meeting.instructor}
          onClose={() => setShowMessageModal(false)}
        />
      )}
    </Modal>
  );
}
