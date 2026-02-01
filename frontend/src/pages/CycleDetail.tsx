import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowRight,
  Calendar,
  Clock,
  Users,
  Building2,
  UserCheck,
  BookOpen,
  CheckCircle,
  XCircle,
  AlertCircle,
  Plus,
  Edit,
  CreditCard,
} from 'lucide-react';
import {
  useCycle,
  useCycleMeetings,
  useCycleRegistrations,
  useUpdateMeeting,
  useUpdateCycle,
  useStudents,
  useInstructors,
  useCreateRegistration,
  useUpdateRegistration,
} from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import {
  cycleStatusHebrew,
  cycleTypeHebrew,
  dayOfWeekHebrew,
  meetingStatusHebrew,
} from '../types';
import type { Meeting, MeetingStatus, Registration, RegistrationStatus, PaymentStatus, PaymentMethod, ActivityType } from '../types';
import { paymentStatusHebrew, activityTypeHebrew } from '../types';

export default function CycleDetail() {
  const { id } = useParams<{ id: string }>();
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [viewingMeeting, setViewingMeeting] = useState<Meeting | null>(null);
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [editingRegistration, setEditingRegistration] = useState<Registration | null>(null);
  const [showChangeInstructorModal, setShowChangeInstructorModal] = useState(false);
  const [selectedMeetingIds, setSelectedMeetingIds] = useState<Set<string>>(new Set());
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);

  const { data: cycle, isLoading } = useCycle(id!);
  const { data: meetings } = useCycleMeetings(id!);
  const { data: registrations } = useCycleRegistrations(id!);
  const { data: allStudents } = useStudents();
  const { data: instructors } = useInstructors();
  const updateMeeting = useUpdateMeeting();
  const updateCycle = useUpdateCycle();
  const createRegistration = useCreateRegistration();
  const updateRegistration = useUpdateRegistration();

  const handleChangeCycleInstructor = async (newInstructorId: string) => {
    try {
      await updateCycle.mutateAsync({
        id: id!,
        data: { instructorId: newInstructorId },
      });
      setShowChangeInstructorModal(false);
    } catch (error) {
      console.error('Failed to update cycle instructor:', error);
      alert('שגיאה בעדכון מדריך המחזור');
    }
  };

  // Bulk edit handlers
  const toggleMeetingSelection = (meetingId: string) => {
    const newSelected = new Set(selectedMeetingIds);
    if (newSelected.has(meetingId)) {
      newSelected.delete(meetingId);
    } else {
      newSelected.add(meetingId);
    }
    setSelectedMeetingIds(newSelected);
  };

  const toggleAllMeetings = () => {
    if (selectedMeetingIds.size === meetings?.length) {
      setSelectedMeetingIds(new Set());
    } else {
      setSelectedMeetingIds(new Set(meetings?.map(m => m.id) || []));
    }
  };

  const handleBulkUpdate = async (data: { instructorId?: string; status?: MeetingStatus }) => {
    try {
      const updatePromises = Array.from(selectedMeetingIds).map(meetingId =>
        updateMeeting.mutateAsync({ id: meetingId, data })
      );
      await Promise.all(updatePromises);
      setSelectedMeetingIds(new Set());
      setShowBulkEditModal(false);
    } catch (error) {
      console.error('Failed to bulk update meetings:', error);
      alert('שגיאה בעדכון הפגישות');
    }
  };

  const handleUpdatePayment = async (data: Partial<Registration>) => {
    if (!editingRegistration) return;
    try {
      await updateRegistration.mutateAsync({
        registrationId: editingRegistration.id,
        cycleId: id!,
        data,
      });
      setEditingRegistration(null);
    } catch (error) {
      console.error('Failed to update registration:', error);
      alert('שגיאה בעדכון פרטי התשלום');
    }
  };

  const handleAddStudent = async (studentId: string) => {
    try {
      await createRegistration.mutateAsync({
        cycleId: id!,
        data: {
          studentId,
          status: 'active',
          registrationDate: new Date().toISOString().split('T')[0],
        },
      });
      setShowAddStudentModal(false);
    } catch (error) {
      console.error('Failed to register student:', error);
      alert('שגיאה בהרשמת התלמיד');
    }
  };

  // Filter out already registered students
  const availableStudents = allStudents?.filter(
    (student) => !registrations?.some((reg) => reg.studentId === student.id)
  ) || [];

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const formatTime = (time: string) => {
    // Handle ISO date format (1970-01-01T16:00:00.000Z) or simple time (16:00)
    if (time.includes('T')) {
      // Extract UTC time directly without timezone conversion
      const date = new Date(time);
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    return time.substring(0, 5);
  };

  const getStatusIcon = (status: MeetingStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="text-green-500" size={18} />;
      case 'cancelled':
        return <XCircle className="text-red-500" size={18} />;
      case 'postponed':
        return <AlertCircle className="text-yellow-500" size={18} />;
      default:
        return <Clock className="text-blue-500" size={18} />;
    }
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

  const handleUpdateMeetingData = async (meetingId: string, data: { status?: MeetingStatus; instructorId?: string; topic?: string; notes?: string }) => {
    try {
      await updateMeeting.mutateAsync({
        id: meetingId,
        data,
      });
      setSelectedMeeting(null);
    } catch (error) {
      console.error('Failed to update meeting:', error);
      alert('שגיאה בעדכון הפגישה');
    }
  };

  if (isLoading) {
    return <Loading size="lg" text="טוען פרטי מחזור..." />;
  }

  if (!cycle) {
    return (
      <EmptyState
        title="מחזור לא נמצא"
        description="המחזור המבוקש לא נמצא במערכת"
        action={
          <Link to="/cycles" className="btn btn-primary">
            חזרה לרשימת מחזורים
          </Link>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={cycle.name}
        actions={
          <Link to="/cycles" className="btn btn-secondary">
            <ArrowRight size={18} />
            חזרה
          </Link>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Cycle Info */}
          <div className="space-y-6">
            {/* Details Card */}
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold">פרטי המחזור</h2>
              </div>
              <div className="card-body space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <BookOpen size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">קורס</p>
                    <p className="font-medium">{cycle.course?.name || '-'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <Building2 size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">סניף</p>
                    <p className="font-medium">{cycle.branch?.name || '-'}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <UserCheck size={18} className="text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">מדריך</p>
                      <p className="font-medium">{cycle.instructor?.name || '-'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowChangeInstructorModal(true)}
                    className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                    title="החלף מדריך"
                  >
                    <Edit size={16} />
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <Calendar size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">יום ושעה</p>
                    <p className="font-medium">
                      {dayOfWeekHebrew[cycle.dayOfWeek]} {formatTime(cycle.startTime)} - {formatTime(cycle.endTime)}
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t flex items-center justify-between">
                  <span className={`badge ${
                    cycle.type === 'private' ? 'badge-warning' : 'badge-info'
                  }`}>
                    {cycleTypeHebrew[cycle.type]}
                  </span>
                  <span className={`badge ${
                    cycle.status === 'active' ? 'badge-success' :
                    cycle.status === 'completed' ? 'badge-info' : 'badge-danger'
                  }`}>
                    {cycleStatusHebrew[cycle.status]}
                  </span>
                </div>
              </div>
            </div>

            {/* Progress Card */}
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold">התקדמות</h2>
              </div>
              <div className="card-body">
                {(() => {
                  // Use cycle fields (totalMeetings - completedMeetings = remainingMeetings)
                  const completedCount = cycle.completedMeetings || 0;
                  const totalCount = cycle.totalMeetings;
                  const remainingCount = cycle.remainingMeetings || (totalCount - completedCount);
                  
                  return (
                    <>
                      <div className="mb-4">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-500">מפגשים</span>
                          <span className="font-medium">
                            {completedCount} / {totalCount}
                          </span>
                        </div>
                        <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 rounded-full transition-all"
                            style={{
                              width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="p-3 bg-green-50 rounded-lg">
                          <p className="text-2xl font-bold text-green-600">{completedCount}</p>
                          <p className="text-xs text-gray-500">הושלמו</p>
                        </div>
                        <div className="p-3 bg-blue-50 rounded-lg">
                          <p className="text-2xl font-bold text-blue-600">{remainingCount}</p>
                          <p className="text-xs text-gray-500">נותרו</p>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-2xl font-bold text-gray-600">{registrations?.length || 0}</p>
                          <p className="text-xs text-gray-500">תלמידים</p>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Registrations */}
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h2 className="font-semibold">תלמידים ({registrations?.length || 0})</h2>
                <button
                  onClick={() => setShowAddStudentModal(true)}
                  className="btn btn-primary text-sm"
                >
                  <Plus size={16} />
                  הוסף תלמיד
                </button>
              </div>
              {registrations && registrations.length > 0 ? (
                <div className="divide-y">
                  {registrations.map((reg) => (
                    <div key={reg.id} className={`p-4 flex items-center justify-between ${reg.status === 'cancelled' ? 'bg-red-50 opacity-60' : ''}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className={`font-medium ${reg.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}>{reg.student?.name}</p>
                          {reg.status === 'cancelled' && (
                            <span className="badge badge-danger text-xs">בוטל</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">
                          {reg.student?.customer?.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-left">
                          {reg.amount && (
                            <p className="text-sm font-medium">₪{reg.amount}</p>
                          )}
                          <span className={`badge ${
                            reg.paymentStatus === 'paid' ? 'badge-success' :
                            reg.paymentStatus === 'partial' ? 'badge-warning' : 'badge-danger'
                          }`}>
                            {paymentStatusHebrew[reg.paymentStatus || 'unpaid']}
                          </span>
                        </div>
                        <button
                          onClick={() => setEditingRegistration(reg)}
                          className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                          title="עדכון הרשמה"
                        >
                          <CreditCard size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-gray-500">
                  <Users size={48} className="mx-auto mb-4 text-gray-300" />
                  <p>אין תלמידים רשומים</p>
                </div>
              )}
            </div>
          </div>

          {/* Meetings */}
          <div className="lg:col-span-2">
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h2 className="font-semibold">מפגשים ({meetings?.length || 0})</h2>
                {selectedMeetingIds.size > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">
                      נבחרו {selectedMeetingIds.size} פגישות
                    </span>
                    <button
                      onClick={() => setShowBulkEditModal(true)}
                      className="btn btn-primary text-sm"
                    >
                      <Edit size={16} />
                      עריכה גורפת
                    </button>
                    <button
                      onClick={() => setSelectedMeetingIds(new Set())}
                      className="btn btn-secondary text-sm"
                    >
                      בטל בחירה
                    </button>
                  </div>
                )}
              </div>
              {meetings && meetings.length > 0 ? (
                <div className="overflow-x-auto">
                  <table>
                    <thead>
                      <tr>
                        <th className="w-10">
                          <input
                            type="checkbox"
                            checked={meetings.length > 0 && selectedMeetingIds.size === meetings.length}
                            onChange={toggleAllMeetings}
                            className="rounded border-gray-300"
                          />
                        </th>
                        <th>#</th>
                        <th>תאריך</th>
                        <th>שעה</th>
                        <th>מדריך</th>
                        <th>סטטוס</th>
                        <th>נושא</th>
                        <th>פעולות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meetings
                        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
                        .map((meeting, index) => (
                          <tr 
                            key={meeting.id} 
                            className={`cursor-pointer hover:bg-gray-50 ${selectedMeetingIds.has(meeting.id) ? 'bg-blue-50' : ''}`}
                            onClick={() => setViewingMeeting(meeting)}
                          >
                            <td onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedMeetingIds.has(meeting.id)}
                                onChange={() => toggleMeetingSelection(meeting.id)}
                                className="rounded border-gray-300"
                              />
                            </td>
                            <td className="font-medium">{index + 1}</td>
                            <td>{formatDate(meeting.scheduledDate)}</td>
                            <td>
                              {formatTime(meeting.startTime)} - {formatTime(meeting.endTime)}
                            </td>
                            <td>{meeting.instructor?.name || cycle.instructor?.name}</td>
                            <td>
                              <span className={`badge ${getStatusBadgeClass(meeting.status)}`}>
                                {meetingStatusHebrew[meeting.status]}
                              </span>
                            </td>
                            <td className="text-gray-500 truncate max-w-[200px]">
                              {meeting.topic || '-'}
                            </td>
                            <td>
                              <button
                                onClick={(e) => { e.stopPropagation(); setSelectedMeeting(meeting); }}
                                className="text-blue-600 hover:underline text-sm"
                              >
                                עדכון
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-gray-500">
                  <Calendar size={48} className="mx-auto mb-4 text-gray-300" />
                  <p>אין מפגשים מתוכננים</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Meeting Details Modal */}
      <Modal
        isOpen={!!viewingMeeting}
        onClose={() => setViewingMeeting(null)}
        title="פרטי מפגש"
        size="lg"
      >
        {viewingMeeting && (
          <div className="p-6 space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">תאריך</p>
                <p className="font-medium">{formatDate(viewingMeeting.scheduledDate)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">שעה</p>
                <p className="font-medium">{formatTime(viewingMeeting.startTime)} - {formatTime(viewingMeeting.endTime)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">מדריך</p>
                <p className="font-medium">{viewingMeeting.instructor?.name || cycle?.instructor?.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">סטטוס</p>
                <span className={`badge ${getStatusBadgeClass(viewingMeeting.status)}`}>
                  {meetingStatusHebrew[viewingMeeting.status]}
                </span>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-gray-500">נושא</p>
                <p className="font-medium">{viewingMeeting.topic || '-'}</p>
              </div>
              {viewingMeeting.notes && (
                <div className="col-span-2">
                  <p className="text-sm text-gray-500">הערות</p>
                  <p className="font-medium">{viewingMeeting.notes}</p>
                </div>
              )}
            </div>

            {/* Financial Info */}
            {viewingMeeting.status === 'completed' && (
              <div className="border-t pt-4">
                <h4 className="font-medium text-gray-700 mb-4">נתונים כספיים</h4>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-4 bg-green-50 rounded-lg">
                    <p className="text-sm text-gray-500">הכנסה</p>
                    <p className="text-2xl font-bold text-green-600">₪{Number(viewingMeeting.revenue || 0).toLocaleString()}</p>
                  </div>
                  <div className="p-4 bg-red-50 rounded-lg">
                    <p className="text-sm text-gray-500">עלות מדריך</p>
                    <p className="text-2xl font-bold text-red-600">₪{Number(viewingMeeting.instructorPayment || 0).toLocaleString()}</p>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-gray-500">רווח</p>
                    <p className={`text-2xl font-bold ${Number(viewingMeeting.profit || 0) >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                      ₪{Number(viewingMeeting.profit || 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                onClick={() => setViewingMeeting(null)}
                className="btn btn-secondary"
              >
                סגור
              </button>
              <button
                onClick={() => { setViewingMeeting(null); setSelectedMeeting(viewingMeeting); }}
                className="btn btn-primary"
              >
                עריכה
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Update Meeting Modal */}
      <Modal
        isOpen={!!selectedMeeting}
        onClose={() => setSelectedMeeting(null)}
        title="עדכון מפגש"
      >
        {selectedMeeting && (
          <MeetingUpdateForm
            meeting={selectedMeeting}
            instructors={instructors || []}
            defaultInstructorId={cycle?.instructorId}
            defaultActivityType={cycle?.activityType}
            onUpdate={(data) => handleUpdateMeetingData(selectedMeeting.id, data)}
            onCancel={() => setSelectedMeeting(null)}
            isLoading={updateMeeting.isPending}
          />
        )}
      </Modal>

      {/* Add Student Modal */}
      <Modal
        isOpen={showAddStudentModal}
        onClose={() => setShowAddStudentModal(false)}
        title="הוסף תלמיד למחזור"
      >
        <div className="p-6">
          {availableStudents.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {availableStudents.map((student) => (
                <button
                  key={student.id}
                  onClick={() => handleAddStudent(student.id)}
                  disabled={createRegistration.isPending}
                  className="w-full p-3 text-right border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors disabled:opacity-50"
                >
                  <p className="font-medium">{student.name}</p>
                  <p className="text-sm text-gray-500">
                    {student.customer?.name} • {student.grade || 'לא צוין כיתה'}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Users size={48} className="mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">
                {allStudents?.length === 0
                  ? 'אין תלמידים במערכת. הוסף תלמידים דרך דף הלקוחות.'
                  : 'כל התלמידים כבר רשומים למחזור זה.'}
              </p>
            </div>
          )}
          <div className="mt-4 pt-4 border-t flex justify-end">
            <button
              onClick={() => setShowAddStudentModal(false)}
              className="btn btn-secondary"
            >
              סגור
            </button>
          </div>
        </div>
      </Modal>

      {/* Payment Edit Modal */}
      <Modal
        isOpen={!!editingRegistration}
        onClose={() => setEditingRegistration(null)}
        title={`עדכון הרשמה - ${editingRegistration?.student?.name || ''}`}
      >
        {editingRegistration && (
          <PaymentEditForm
            registration={editingRegistration}
            onSubmit={handleUpdatePayment}
            onCancel={() => setEditingRegistration(null)}
            isLoading={updateRegistration.isPending}
          />
        )}
      </Modal>

      {/* Change Cycle Instructor Modal */}
      <Modal
        isOpen={showChangeInstructorModal}
        onClose={() => setShowChangeInstructorModal(false)}
        title="החלפת מדריך למחזור"
      >
        <div className="p-6">
          <p className="text-sm text-gray-500 mb-4">
            בחר מדריך חדש עבור המחזור "{cycle?.name}". שים לב: שינוי זה לא ישפיע על פגישות קיימות - רק על מחזור עתידי.
          </p>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {instructors?.filter(i => i.isActive).map((instructor) => (
              <button
                key={instructor.id}
                onClick={() => handleChangeCycleInstructor(instructor.id)}
                disabled={updateCycle.isPending || instructor.id === cycle?.instructorId}
                className={`w-full p-3 text-right border rounded-lg transition-colors disabled:opacity-50 ${
                  instructor.id === cycle?.instructorId
                    ? 'border-blue-300 bg-blue-50'
                    : 'hover:bg-blue-50 hover:border-blue-300'
                }`}
              >
                <p className="font-medium">{instructor.name}</p>
                <p className="text-sm text-gray-500">{instructor.phone}</p>
                {instructor.id === cycle?.instructorId && (
                  <span className="text-xs text-blue-600">מדריך נוכחי</span>
                )}
              </button>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t flex justify-end">
            <button
              onClick={() => setShowChangeInstructorModal(false)}
              className="btn btn-secondary"
            >
              ביטול
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Edit Modal */}
      <Modal
        isOpen={showBulkEditModal}
        onClose={() => setShowBulkEditModal(false)}
        title={`עריכה גורפת (${selectedMeetingIds.size} פגישות)`}
      >
        <BulkEditForm
          instructors={instructors || []}
          onSubmit={handleBulkUpdate}
          onCancel={() => setShowBulkEditModal(false)}
          isLoading={updateMeeting.isPending}
        />
      </Modal>
    </>
  );
}

// Payment Edit Form
interface PaymentEditFormProps {
  registration: Registration;
  onSubmit: (data: Partial<Registration>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function PaymentEditForm({ registration, onSubmit, onCancel, isLoading }: PaymentEditFormProps) {
  const [formData, setFormData] = useState<{
    status: RegistrationStatus;
    amount: number;
    paymentStatus: PaymentStatus;
    paymentMethod: string;
    invoiceLink: string;
    notes: string;
  }>({
    status: registration.status || 'active' as RegistrationStatus,
    amount: registration.amount || 0,
    paymentStatus: registration.paymentStatus || 'unpaid',
    paymentMethod: registration.paymentMethod || '',
    invoiceLink: registration.invoiceLink || '',
    notes: registration.notes || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      status: formData.status as RegistrationStatus,
      amount: formData.amount ? Number(formData.amount) : undefined,
      paymentStatus: formData.paymentStatus as PaymentStatus,
      paymentMethod: formData.paymentMethod as PaymentMethod || undefined,
      invoiceLink: formData.invoiceLink || undefined,
      notes: formData.notes || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      {/* Registration Status */}
      <div>
        <label className="form-label">סטטוס הרשמה</label>
        <select
          value={formData.status}
          onChange={(e) => setFormData({ ...formData, status: e.target.value as RegistrationStatus })}
          className="form-input"
        >
          <option value="registered">נרשם</option>
          <option value="active">פעיל</option>
          <option value="completed">הושלם</option>
          <option value="cancelled">בוטל</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">סכום לתשלום (₪)</label>
          <input
            type="number"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
            className="form-input"
            min="0"
          />
        </div>

        <div>
          <label className="form-label">סטטוס תשלום</label>
          <select
            value={formData.paymentStatus}
            onChange={(e) => setFormData({ ...formData, paymentStatus: e.target.value as PaymentStatus })}
            className="form-input"
          >
            <option value="unpaid">לא שולם</option>
            <option value="partial">שולם חלקית</option>
            <option value="paid">שולם במלואו</option>
          </select>
        </div>

        <div>
          <label className="form-label">אמצעי תשלום</label>
          <select
            value={formData.paymentMethod}
            onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
            className="form-input"
          >
            <option value="">בחר...</option>
            <option value="credit">אשראי</option>
            <option value="transfer">העברה בנקאית</option>
            <option value="cash">מזומן</option>
          </select>
        </div>

        <div>
          <label className="form-label">קישור לחשבונית</label>
          <input
            type="url"
            value={formData.invoiceLink}
            onChange={(e) => setFormData({ ...formData, invoiceLink: e.target.value })}
            className="form-input"
            dir="ltr"
            placeholder="https://..."
          />
        </div>

        <div className="col-span-2">
          <label className="form-label">הערות</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="form-input"
            rows={2}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button type="submit" className="btn btn-primary" disabled={isLoading}>
          {isLoading ? 'שומר...' : 'שמור'}
        </button>
      </div>
    </form>
  );
}

// Meeting Update Form
interface MeetingUpdateFormProps {
  meeting: Meeting;
  instructors: { id: string; name: string; isActive: boolean }[];
  defaultInstructorId?: string;
  defaultActivityType?: ActivityType;
  onUpdate: (data: { status?: MeetingStatus; instructorId?: string; activityType?: ActivityType; topic?: string; notes?: string }) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function MeetingUpdateForm({ meeting, instructors, defaultInstructorId, defaultActivityType, onUpdate, onCancel, isLoading }: MeetingUpdateFormProps) {
  const [status, setStatus] = useState(meeting.status);
  const [instructorId, setInstructorId] = useState(meeting.instructor?.id || defaultInstructorId || '');
  const [activityType, setActivityType] = useState<ActivityType>(meeting.activityType || defaultActivityType || 'frontal');
  const [topic, setTopic] = useState(meeting.topic || '');
  const [notes, setNotes] = useState(meeting.notes || '');

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  };

  const handleSubmit = () => {
    onUpdate({
      status,
      instructorId: instructorId !== (meeting.instructor?.id || defaultInstructorId) ? instructorId : undefined,
      activityType: activityType !== (meeting.activityType || defaultActivityType) ? activityType : undefined,
      topic: topic || undefined,
      notes: notes || undefined,
    });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-sm text-gray-500">תאריך המפגש</p>
        <p className="font-medium">{formatDate(meeting.scheduledDate)}</p>
      </div>

      <div>
        <label className="form-label">מדריך</label>
        <select
          value={instructorId}
          onChange={(e) => setInstructorId(e.target.value)}
          className="form-input"
        >
          {instructors.filter(i => i.isActive).map((instructor) => (
            <option key={instructor.id} value={instructor.id}>
              {instructor.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="form-label">סטטוס</label>
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setStatus('scheduled')}
            className={`p-3 rounded-lg border-2 flex items-center gap-2 transition-colors ${
              status === 'scheduled'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <Clock size={20} />
            <span>מתוכנן</span>
          </button>
          <button
            type="button"
            onClick={() => setStatus('completed')}
            className={`p-3 rounded-lg border-2 flex items-center gap-2 transition-colors ${
              status === 'completed'
                ? 'border-green-500 bg-green-50 text-green-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <CheckCircle size={20} />
            <span>התקיים</span>
          </button>
          <button
            type="button"
            onClick={() => setStatus('cancelled')}
            className={`p-3 rounded-lg border-2 flex items-center gap-2 transition-colors ${
              status === 'cancelled'
                ? 'border-red-500 bg-red-50 text-red-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <XCircle size={20} />
            <span>בוטל</span>
          </button>
        </div>
      </div>

      <div>
        <label className="form-label">סוג פעילות</label>
        <select
          value={activityType}
          onChange={(e) => setActivityType(e.target.value as ActivityType)}
          className="form-input"
        >
          <option value="frontal">פרונטלי</option>
          <option value="online">אונליין</option>
          <option value="private_lesson">פרטי</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">משפיע על חישוב התשלום למדריך</p>
      </div>

      <div>
        <label className="form-label">נושא השיעור</label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="form-input"
          placeholder="מה נלמד בשיעור?"
        />
      </div>

      <div>
        <label className="form-label">הערות</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="form-input"
          rows={3}
          placeholder="הערות נוספות..."
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button
          onClick={handleSubmit}
          className="btn btn-primary"
          disabled={isLoading}
        >
          {isLoading ? 'שומר...' : 'שמור'}
        </button>
      </div>
    </div>
  );
}

// Bulk Edit Form
interface BulkEditFormProps {
  instructors: { id: string; name: string; isActive: boolean }[];
  onSubmit: (data: { instructorId?: string; status?: MeetingStatus }) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function BulkEditForm({ instructors, onSubmit, onCancel, isLoading }: BulkEditFormProps) {
  const [updateInstructor, setUpdateInstructor] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(false);
  const [instructorId, setInstructorId] = useState('');
  const [status, setStatus] = useState<MeetingStatus>('scheduled');

  const handleSubmit = () => {
    const data: { instructorId?: string; status?: MeetingStatus } = {};
    if (updateInstructor && instructorId) {
      data.instructorId = instructorId;
    }
    if (updateStatus) {
      data.status = status;
    }
    if (Object.keys(data).length === 0) {
      alert('יש לבחור לפחות שדה אחד לעדכון');
      return;
    }
    onSubmit(data);
  };

  return (
    <div className="p-6 space-y-6">
      <p className="text-sm text-gray-500">
        בחר את השדות שברצונך לעדכן עבור כל הפגישות שנבחרו:
      </p>

      {/* Update Instructor */}
      <div className="border rounded-lg p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={updateInstructor}
            onChange={(e) => setUpdateInstructor(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="font-medium">שנה מדריך</span>
        </label>
        {updateInstructor && (
          <div className="mt-4">
            <select
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
              className="form-input"
            >
              <option value="">בחר מדריך...</option>
              {instructors.filter(i => i.isActive).map((instructor) => (
                <option key={instructor.id} value={instructor.id}>
                  {instructor.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Update Status */}
      <div className="border rounded-lg p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={updateStatus}
            onChange={(e) => setUpdateStatus(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="font-medium">שנה סטטוס</span>
        </label>
        {updateStatus && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setStatus('scheduled')}
              className={`p-3 rounded-lg border-2 flex items-center gap-2 transition-colors ${
                status === 'scheduled'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Clock size={20} />
              <span>מתוכנן</span>
            </button>
            <button
              type="button"
              onClick={() => setStatus('completed')}
              className={`p-3 rounded-lg border-2 flex items-center gap-2 transition-colors ${
                status === 'completed'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <CheckCircle size={20} />
              <span>התקיים</span>
            </button>
            <button
              type="button"
              onClick={() => setStatus('cancelled')}
              className={`p-3 rounded-lg border-2 flex items-center gap-2 transition-colors ${
                status === 'cancelled'
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <XCircle size={20} />
              <span>בוטל</span>
            </button>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button
          onClick={handleSubmit}
          className="btn btn-primary"
          disabled={isLoading || (!updateInstructor && !updateStatus)}
        >
          {isLoading ? 'מעדכן...' : 'עדכן פגישות'}
        </button>
      </div>
    </div>
  );
}
