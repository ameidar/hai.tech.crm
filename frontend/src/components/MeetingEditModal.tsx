import { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import { meetingStatusHebrew, activityTypeHebrew } from '../types';
import { useInstructors } from '../hooks/useApi';
import type { Meeting, MeetingStatus, ActivityType, InstructorRole } from '../types';

const instructorRoleHebrew: Record<InstructorRole | '', string> = {
  '': 'לא מוגדר',
  'primary': 'מדריך ראשי',
  'support': 'תומך הוראה',
};

interface MeetingEditModalProps {
  meeting: Meeting | null;
  onClose: () => void;
  onSave: (id: string, data: Partial<Meeting>) => Promise<void>;
  isSaving: boolean;
}

export default function MeetingEditModal({ 
  meeting, 
  onClose, 
  onSave,
  isSaving,
}: MeetingEditModalProps) {
  const { data: instructors } = useInstructors();
  const [formData, setFormData] = useState({
    status: 'scheduled' as MeetingStatus,
    activityType: 'frontal' as ActivityType,
    instructorId: '',
    instructorRole: '' as InstructorRole | '',
    topic: '',
    notes: '',
    scheduledDate: '',
    startTime: '',
    endTime: '',
  });

  useEffect(() => {
    if (meeting) {
      setFormData({
        status: meeting.status,
        activityType: meeting.activityType || meeting.cycle?.activityType || 'frontal',
        instructorId: meeting.instructorId || '',
        instructorRole: meeting.instructorRole || '',
        topic: meeting.topic || '',
        notes: meeting.notes || '',
        scheduledDate: meeting.scheduledDate ? new Date(meeting.scheduledDate).toISOString().split('T')[0] : '',
        startTime: formatTime(meeting.startTime),
        endTime: formatTime(meeting.endTime),
      });
    }
  }, [meeting]);

  const formatTime = (time: string | Date | null | undefined): string => {
    if (!time) return '';
    if (typeof time === 'string') {
      if (time.includes('T')) {
        const date = new Date(time);
        return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
      }
      return time.substring(0, 5);
    }
    if (time instanceof Date) {
      return `${time.getUTCHours().toString().padStart(2, '0')}:${time.getUTCMinutes().toString().padStart(2, '0')}`;
    }
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meeting) return;

    await onSave(meeting.id, {
      status: formData.status,
      activityType: formData.activityType,
      instructorId: formData.instructorId || undefined,
      instructorRole: formData.instructorRole || undefined,
      topic: formData.topic || undefined,
      notes: formData.notes || undefined,
      scheduledDate: formData.scheduledDate,
      startTime: formData.startTime,
      endTime: formData.endTime,
    });
  };

  if (!meeting) return null;

  return (
    <Modal
      isOpen={!!meeting}
      onClose={onClose}
      title="עריכת פגישה"
      size="md"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        {/* Meeting Info Header */}
        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="font-medium">{meeting.cycle?.name}</p>
          <p className="text-sm text-gray-500">{meeting.cycle?.course?.name} • {meeting.instructor?.name}</p>
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">סטטוס</label>
          <select
            value={formData.status}
            onChange={(e) => setFormData({ ...formData, status: e.target.value as MeetingStatus })}
            className="input w-full"
          >
            {Object.entries(meetingStatusHebrew).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Activity Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">סוג פעילות</label>
          <select
            value={formData.activityType}
            onChange={(e) => setFormData({ ...formData, activityType: e.target.value as ActivityType })}
            className="input w-full"
          >
            {Object.entries(activityTypeHebrew).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Instructor */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">מדריך</label>
            <select
              value={formData.instructorId}
              onChange={(e) => setFormData({ ...formData, instructorId: e.target.value })}
              className="input w-full"
            >
              <option value="">בחר מדריך</option>
              {instructors?.map((instructor) => (
                <option key={instructor.id} value={instructor.id}>{instructor.name}</option>
              ))}
            </select>
          </div>

          {/* Instructor Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">תפקיד</label>
            <select
              value={formData.instructorRole}
              onChange={(e) => setFormData({ ...formData, instructorRole: e.target.value as InstructorRole | '' })}
              className="input w-full"
            >
              {Object.entries(instructorRoleHebrew).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Date and Time */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">תאריך</label>
            <input
              type="date"
              value={formData.scheduledDate}
              onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">שעת התחלה</label>
            <input
              type="time"
              value={formData.startTime}
              onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">שעת סיום</label>
            <input
              type="time"
              value={formData.endTime}
              onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
              className="input w-full"
            />
          </div>
        </div>

        {/* Topic */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">נושא</label>
          <input
            type="text"
            value={formData.topic}
            onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
            className="input w-full"
            placeholder="נושא הפגישה"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">הערות</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="input w-full"
            rows={3}
            placeholder="הערות לפגישה"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            ביטול
          </button>
          <button type="submit" disabled={isSaving} className="btn btn-primary">
            {isSaving ? 'שומר...' : 'שמור'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
