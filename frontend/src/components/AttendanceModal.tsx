import { useState, useMemo } from 'react';
import { X, Check, UserMinus, Clock, UserPlus, Search, Users } from 'lucide-react';
import Modal from './ui/Modal';
import Loading from './ui/Loading';
import {
  useMeetingAttendance,
  useRecordAttendance,
  useSearchStudentsForAttendance,
  type AttendanceRecord,
} from '../hooks/useApi';

interface AttendanceModalProps {
  meetingId: string;
  meetingDate: string;
  cycleName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function AttendanceModal({
  meetingId,
  meetingDate,
  cycleName,
  isOpen,
  onClose,
}: AttendanceModalProps) {
  const { data, isLoading } = useMeetingAttendance(isOpen ? meetingId : undefined);
  const recordAttendance = useRecordAttendance();
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [guestName, setGuestName] = useState('');

  const { data: searchResults } = useSearchStudentsForAttendance(
    showAddStudent ? meetingId : undefined,
    searchQuery
  );

  const handleStatusChange = async (
    record: AttendanceRecord,
    status: 'present' | 'absent' | 'late'
  ) => {
    try {
      await recordAttendance.mutateAsync({
        meetingId,
        data: {
          registrationId: record.registrationId || undefined,
          studentId: record.studentId || undefined,
          status,
          isTrial: record.isTrial,
        },
      });
    } catch (error) {
      console.error('Failed to record attendance:', error);
    }
  };

  const handleAddTrialStudent = async (studentId: string) => {
    try {
      await recordAttendance.mutateAsync({
        meetingId,
        data: {
          studentId,
          status: 'present',
          isTrial: true,
        },
      });
      setSearchQuery('');
      setShowAddStudent(false);
    } catch (error) {
      console.error('Failed to add trial student:', error);
    }
  };

  const handleAddGuest = async () => {
    if (!guestName.trim()) return;
    try {
      await recordAttendance.mutateAsync({
        meetingId,
        data: {
          guestName: guestName.trim(),
          status: 'present',
          isTrial: true,
        },
      });
      setGuestName('');
      setShowAddStudent(false);
    } catch (error) {
      console.error('Failed to add guest:', error);
    }
  };

  const statusButtons = (record: AttendanceRecord) => (
    <div className="flex gap-1">
      <button
        onClick={() => handleStatusChange(record, 'present')}
        className={`p-1.5 rounded-lg transition-colors ${
          record.status === 'present'
            ? 'bg-green-500 text-white'
            : 'bg-gray-100 text-gray-400 hover:bg-green-100 hover:text-green-600'
        }`}
        title="נוכח"
      >
        <Check size={18} />
      </button>
      <button
        onClick={() => handleStatusChange(record, 'absent')}
        className={`p-1.5 rounded-lg transition-colors ${
          record.status === 'absent'
            ? 'bg-red-500 text-white'
            : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-600'
        }`}
        title="חסר"
      >
        <UserMinus size={18} />
      </button>
      <button
        onClick={() => handleStatusChange(record, 'late')}
        className={`p-1.5 rounded-lg transition-colors ${
          record.status === 'late'
            ? 'bg-yellow-500 text-white'
            : 'bg-gray-100 text-gray-400 hover:bg-yellow-100 hover:text-yellow-600'
        }`}
        title="איחור"
      >
        <Clock size={18} />
      </button>
    </div>
  );

  const formattedDate = useMemo(() => {
    return new Date(meetingDate).toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }, [meetingDate]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="נוכחות" size="lg">
      <div className="p-4">
        {/* Header */}
        <div className="mb-4 pb-4 border-b">
          <h3 className="font-semibold text-lg">{cycleName}</h3>
          <p className="text-gray-500 text-sm">{formattedDate}</p>
        </div>

        {isLoading ? (
          <Loading size="md" text="טוען נוכחות..." />
        ) : data ? (
          <>
            {/* Stats */}
            <div className="flex gap-4 mb-4 text-sm">
              <div className="flex items-center gap-1">
                <Users size={16} className="text-gray-400" />
                <span>{data.stats.total} תלמידים</span>
              </div>
              <div className="flex items-center gap-1 text-green-600">
                <Check size={16} />
                <span>{data.stats.present} נוכחים</span>
              </div>
              <div className="flex items-center gap-1 text-red-600">
                <UserMinus size={16} />
                <span>{data.stats.absent} חסרים</span>
              </div>
              {data.stats.trials > 0 && (
                <div className="flex items-center gap-1 text-blue-600">
                  <UserPlus size={16} />
                  <span>{data.stats.trials} ניסיון</span>
                </div>
              )}
            </div>

            {/* Attendance List */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {data.attendance.map((record, idx) => (
                <div
                  key={record.registrationId || record.studentId || idx}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    record.isTrial ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{record.studentName}</span>
                      {record.isTrial && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                          ניסיון
                        </span>
                      )}
                      {record.grade && (
                        <span className="text-xs text-gray-500">כיתה {record.grade}</span>
                      )}
                    </div>
                    {record.customerName && (
                      <p className="text-xs text-gray-500">
                        {record.customerName}
                        {record.customerPhone && ` • ${record.customerPhone}`}
                      </p>
                    )}
                  </div>
                  {statusButtons(record)}
                </div>
              ))}
            </div>

            {/* Add Student Section */}
            <div className="mt-4 pt-4 border-t">
              {!showAddStudent ? (
                <button
                  onClick={() => setShowAddStudent(true)}
                  className="btn btn-secondary w-full"
                >
                  <UserPlus size={18} />
                  הוסף תלמיד לניסיון
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">הוסף תלמיד לניסיון</h4>
                    <button
                      onClick={() => {
                        setShowAddStudent(false);
                        setSearchQuery('');
                        setGuestName('');
                      }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  {/* Search existing students */}
                  <div>
                    <label className="text-sm text-gray-600 mb-1 block">
                      חפש תלמיד קיים במערכת:
                    </label>
                    <div className="relative">
                      <Search
                        size={18}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                      />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="שם תלמיד או הורה..."
                        className="form-input pr-10"
                      />
                    </div>
                    {searchResults && searchResults.length > 0 && (
                      <div className="mt-2 border rounded-lg max-h-[150px] overflow-y-auto">
                        {searchResults.map((student) => (
                          <button
                            key={student.id}
                            onClick={() => handleAddTrialStudent(student.id)}
                            className="w-full text-right p-2 hover:bg-gray-50 border-b last:border-b-0 transition-colors"
                          >
                            <div className="font-medium">{student.name}</div>
                            <div className="text-xs text-gray-500">
                              {student.customerName} • {student.customerPhone}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Or add guest */}
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span>או</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>

                  <div>
                    <label className="text-sm text-gray-600 mb-1 block">
                      הוסף אורח חדש (לא במערכת):
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="שם האורח..."
                        className="form-input flex-1"
                      />
                      <button
                        onClick={handleAddGuest}
                        disabled={!guestName.trim()}
                        className="btn btn-primary"
                      >
                        הוסף
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="text-center text-gray-500 py-8">לא נמצאו נתונים</div>
        )}
      </div>
    </Modal>
  );
}
