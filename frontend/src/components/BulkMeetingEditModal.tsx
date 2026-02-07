import { useState } from 'react';
import Modal from './ui/Modal';
import { meetingStatusHebrew, activityTypeHebrew } from '../types';
import type { MeetingStatus, ActivityType } from '../types';

interface BulkMeetingEditModalProps {
  isOpen: boolean;
  selectedCount: number;
  onClose: () => void;
  onSave: (data: BulkMeetingUpdateData) => Promise<void>;
  isSaving: boolean;
}

export interface BulkMeetingUpdateData {
  status?: MeetingStatus;
  activityType?: ActivityType;
  topic?: string;
  notes?: string;
  scheduledDate?: string;
  startTime?: string;
  endTime?: string;
}

export default function BulkMeetingEditModal({ 
  isOpen,
  selectedCount,
  onClose, 
  onSave,
  isSaving,
}: BulkMeetingEditModalProps) {
  const [enabledFields, setEnabledFields] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState<BulkMeetingUpdateData>({
    status: undefined,
    activityType: undefined,
    topic: '',
    notes: '',
    scheduledDate: '',
    startTime: '',
    endTime: '',
  });

  const toggleField = (field: string) => {
    const newEnabled = new Set(enabledFields);
    if (newEnabled.has(field)) {
      newEnabled.delete(field);
    } else {
      newEnabled.add(field);
    }
    setEnabledFields(newEnabled);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Only send enabled fields
    const dataToSend: BulkMeetingUpdateData = {};
    if (enabledFields.has('status') && formData.status) dataToSend.status = formData.status;
    if (enabledFields.has('activityType') && formData.activityType) dataToSend.activityType = formData.activityType;
    if (enabledFields.has('topic')) dataToSend.topic = formData.topic;
    if (enabledFields.has('notes')) dataToSend.notes = formData.notes;
    if (enabledFields.has('scheduledDate') && formData.scheduledDate) dataToSend.scheduledDate = formData.scheduledDate;
    if (enabledFields.has('startTime') && formData.startTime) dataToSend.startTime = formData.startTime;
    if (enabledFields.has('endTime') && formData.endTime) dataToSend.endTime = formData.endTime;

    if (Object.keys(dataToSend).length === 0) {
      alert('יש לבחור לפחות שדה אחד לעדכון');
      return;
    }

    await onSave(dataToSend);
  };

  const handleClose = () => {
    setEnabledFields(new Set());
    setFormData({
      status: undefined,
      activityType: undefined,
      topic: '',
      notes: '',
      scheduledDate: '',
      startTime: '',
      endTime: '',
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`עריכה גורפת - ${selectedCount} פגישות`}
      size="md"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <p className="text-sm text-gray-600 bg-yellow-50 p-3 rounded-lg">
          סמן את השדות שברצונך לעדכן. רק שדות מסומנים יעודכנו.
        </p>

        {/* Status */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="enable-status"
            checked={enabledFields.has('status')}
            onChange={() => toggleField('status')}
            className="mt-2"
          />
          <div className="flex-1">
            <label htmlFor="enable-status" className="block text-sm font-medium text-gray-700 mb-1">סטטוס</label>
            <select
              value={formData.status || ''}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as MeetingStatus })}
              className="input w-full"
              disabled={!enabledFields.has('status')}
            >
              <option value="">בחר סטטוס</option>
              {Object.entries(meetingStatusHebrew).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Activity Type */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="enable-activityType"
            checked={enabledFields.has('activityType')}
            onChange={() => toggleField('activityType')}
            className="mt-2"
          />
          <div className="flex-1">
            <label htmlFor="enable-activityType" className="block text-sm font-medium text-gray-700 mb-1">סוג פעילות</label>
            <select
              value={formData.activityType || ''}
              onChange={(e) => setFormData({ ...formData, activityType: e.target.value as ActivityType })}
              className="input w-full"
              disabled={!enabledFields.has('activityType')}
            >
              <option value="">בחר סוג</option>
              {Object.entries(activityTypeHebrew).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Date */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="enable-scheduledDate"
            checked={enabledFields.has('scheduledDate')}
            onChange={() => toggleField('scheduledDate')}
            className="mt-2"
          />
          <div className="flex-1">
            <label htmlFor="enable-scheduledDate" className="block text-sm font-medium text-gray-700 mb-1">תאריך</label>
            <input
              type="date"
              value={formData.scheduledDate || ''}
              onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
              className="input w-full"
              disabled={!enabledFields.has('scheduledDate')}
            />
          </div>
        </div>

        {/* Start Time */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="enable-startTime"
            checked={enabledFields.has('startTime')}
            onChange={() => toggleField('startTime')}
            className="mt-2"
          />
          <div className="flex-1">
            <label htmlFor="enable-startTime" className="block text-sm font-medium text-gray-700 mb-1">שעת התחלה</label>
            <input
              type="time"
              value={formData.startTime || ''}
              onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
              className="input w-full"
              disabled={!enabledFields.has('startTime')}
            />
          </div>
        </div>

        {/* End Time */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="enable-endTime"
            checked={enabledFields.has('endTime')}
            onChange={() => toggleField('endTime')}
            className="mt-2"
          />
          <div className="flex-1">
            <label htmlFor="enable-endTime" className="block text-sm font-medium text-gray-700 mb-1">שעת סיום</label>
            <input
              type="time"
              value={formData.endTime || ''}
              onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
              className="input w-full"
              disabled={!enabledFields.has('endTime')}
            />
          </div>
        </div>

        {/* Topic */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="enable-topic"
            checked={enabledFields.has('topic')}
            onChange={() => toggleField('topic')}
            className="mt-2"
          />
          <div className="flex-1">
            <label htmlFor="enable-topic" className="block text-sm font-medium text-gray-700 mb-1">נושא</label>
            <input
              type="text"
              value={formData.topic || ''}
              onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
              className="input w-full"
              placeholder="נושא הפגישה"
              disabled={!enabledFields.has('topic')}
            />
          </div>
        </div>

        {/* Notes */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="enable-notes"
            checked={enabledFields.has('notes')}
            onChange={() => toggleField('notes')}
            className="mt-2"
          />
          <div className="flex-1">
            <label htmlFor="enable-notes" className="block text-sm font-medium text-gray-700 mb-1">הערות</label>
            <textarea
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="input w-full"
              rows={2}
              placeholder="הערות לפגישה"
              disabled={!enabledFields.has('notes')}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4 border-t">
          <span className="text-sm text-gray-500">
            {enabledFields.size} שדות נבחרו לעדכון
          </span>
          <div className="flex gap-3">
            <button type="button" onClick={handleClose} className="btn btn-secondary">
              ביטול
            </button>
            <button 
              type="submit" 
              disabled={isSaving || enabledFields.size === 0} 
              className="btn btn-primary"
            >
              {isSaving ? 'מעדכן...' : `עדכן ${selectedCount} פגישות`}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
