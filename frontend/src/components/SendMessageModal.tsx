import { useState, useEffect } from 'react';
import { MessageSquare, Mail, Send, X, Loader2 } from 'lucide-react';
import Modal from './ui/Modal';
import { useMessageTemplates, useSendMessage, useInstructorMeetings } from '../hooks/useApi';
import type { Instructor, Meeting } from '../types';

interface SendMessageModalProps {
  instructor: Instructor | null;
  onClose: () => void;
}

interface MessageTemplate {
  id: string;
  name: string;
  channel: 'whatsapp' | 'email' | 'both';
  subject: string | null;
  body: string;
  placeholders: string[];
}

export default function SendMessageModal({ instructor, onClose }: SendMessageModalProps) {
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [templateId, setTemplateId] = useState<string>('');
  const [customMessage, setCustomMessage] = useState('');
  const [customSubject, setCustomSubject] = useState('');
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>('');
  const [preview, setPreview] = useState('');

  const { data: templates } = useMessageTemplates();
  const sendMessage = useSendMessage();
  
  // Get today's meetings for this instructor
  const today = new Date().toISOString().split('T')[0];
  const { data: todayMeetings } = useInstructorMeetings(instructor?.id, today);

  // Filter templates by channel
  const availableTemplates = templates?.filter(
    (t: MessageTemplate) => t.channel === 'both' || t.channel === channel
  ) || [];

  // Get selected template
  const selectedTemplate = templates?.find((t: MessageTemplate) => t.id === templateId);

  // Reset meeting selection when template changes
  useEffect(() => {
    setSelectedMeetingId('');
    setCustomMessage('');
  }, [templateId]);

  // Check if template needs a meeting selection
  const needsMeeting = !!selectedTemplate?.body?.includes('{{cycle_name}}');
  // Check if template needs a custom message
  const needsCustomMessage = !!selectedTemplate?.body?.includes('{{custom_message}}');

  // Update preview when template or meeting changes
  useEffect(() => {
    if (!selectedTemplate || !instructor) {
      setPreview(customMessage);
      return;
    }

    let text = selectedTemplate.body;
    
    // Replace instructor name
    text = text.replace(/{{instructor_name}}/g, instructor.name);
    
    // Replace custom message
    text = text.replace(/{{custom_message}}/g, customMessage);
    
    // Replace meeting data if selected
    if (selectedMeetingId && todayMeetings) {
      const meeting = todayMeetings.find((m: Meeting) => m.id === selectedMeetingId);
      if (meeting) {
        text = text.replace(/{{cycle_name}}/g, meeting.cycle?.name || '');
        text = text.replace(/{{branch_name}}/g, meeting.cycle?.branch?.name || '');
        text = text.replace(/{{course_name}}/g, meeting.cycle?.course?.name || '');
        text = text.replace(/{{meeting_time}}/g, formatTime(meeting.startTime));
        text = text.replace(/{{meeting_date}}/g, new Date(meeting.scheduledDate).toLocaleDateString('he-IL'));
        text = text.replace(/{{zoom_link}}/g, meeting.zoomJoinUrl || 'אין קישור זום');
        text = text.replace(/{{zoom_host_key}}/g, (meeting as any).zoomHostKey || '');
        text = text.replace(/{{status_link}}/g, `${window.location.origin}/meetings/${meeting.id}`);
        text = text.replace(/{{meeting_link}}/g, `${window.location.origin}/meetings/${meeting.id}`);
      }
    }
    
    // Replace instructor link
    text = text.replace(/{{instructor_link}}/g, `${window.location.origin}/instructor`);
    
    setPreview(text);
  }, [selectedTemplate, instructor, customMessage, selectedMeetingId, todayMeetings]);

  const formatTime = (time: string | null): string => {
    if (!time) return '';
    if (time.includes('T')) {
      const date = new Date(time);
      return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
    }
    return time.substring(0, 5);
  };

  const handleSend = async () => {
    if (!instructor) return;

    try {
      await sendMessage.mutateAsync({
        instructorId: instructor.id,
        channel,
        templateId: templateId || undefined,
        customMessage: customMessage || undefined,
        customSubject: channel === 'email' ? customSubject : undefined,
        meetingId: selectedMeetingId || undefined,
      });

      alert('ההודעה נשלחה בהצלחה!');
      onClose();
    } catch (error: any) {
      alert(`שגיאה בשליחה: ${error.message}`);
    }
  };

  if (!instructor) return null;

  const canSendWhatsApp = !!instructor.phone;
  const canSendEmail = !!instructor.email;

  return (
    <Modal
      isOpen={!!instructor}
      onClose={onClose}
      title={`שליחת הודעה ל${instructor.name}`}
      size="lg"
    >
      <div className="p-6 space-y-5">
        {/* Instructor Info */}
        <div className="p-3 bg-gray-50 rounded-lg flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
            <span className="text-xl">{instructor.name.charAt(0)}</span>
          </div>
          <div>
            <p className="font-medium">{instructor.name}</p>
            <p className="text-sm text-gray-500">
              {instructor.phone && <span className="ml-3">📱 {instructor.phone}</span>}
              {instructor.email && <span>✉️ {instructor.email}</span>}
            </p>
          </div>
        </div>

        {/* Channel Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">ערוץ שליחה</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setChannel('whatsapp')}
              disabled={!canSendWhatsApp}
              className={`flex-1 p-3 rounded-lg border-2 flex items-center justify-center gap-2 transition-all ${
                channel === 'whatsapp'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 hover:border-gray-300'
              } ${!canSendWhatsApp ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <MessageSquare size={20} />
              <span>WhatsApp</span>
            </button>
            <button
              type="button"
              onClick={() => setChannel('email')}
              disabled={!canSendEmail}
              className={`flex-1 p-3 rounded-lg border-2 flex items-center justify-center gap-2 transition-all ${
                channel === 'email'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 hover:border-gray-300'
              } ${!canSendEmail ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Mail size={20} />
              <span>אימייל</span>
            </button>
          </div>
        </div>

        {/* Template Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">תבנית</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="input w-full"
          >
            <option value="">-- בחר תבנית --</option>
            {availableTemplates.map((template: MessageTemplate) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>

        {/* Meeting Selection (for templates that need it) */}
        {needsMeeting && todayMeetings && todayMeetings.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">בחר שיעור</label>
            <select
              value={selectedMeetingId}
              onChange={(e) => setSelectedMeetingId(e.target.value)}
              className="input w-full"
            >
              <option value="">-- בחר שיעור --</option>
              {todayMeetings.map((meeting: Meeting) => (
                <option key={meeting.id} value={meeting.id}>
                  {formatTime(meeting.startTime)} - {meeting.cycle?.name} ({meeting.cycle?.branch?.name})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* No meetings today warning */}
        {needsMeeting && todayMeetings && todayMeetings.length === 0 && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
            ⚠️ אין שיעורים למדריך זה היום
          </div>
        )}

        {/* Subject (for email) */}
        {channel === 'email' && selectedTemplate && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">נושא</label>
            {selectedTemplate.subject ? (
              <div className="p-2 bg-gray-50 border rounded text-sm text-gray-700">
                {selectedTemplate.subject.replace(/{{cycle_name}}/g, 
                  (selectedMeetingId && todayMeetings?.find((m: Meeting) => m.id === selectedMeetingId)?.cycle?.name) || '...')}
              </div>
            ) : (
              <input
                type="text"
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
                className="input w-full"
                placeholder="נושא ההודעה"
              />
            )}
          </div>
        )}

        {/* Custom Message (for templates that need it) */}
        {needsCustomMessage && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">הודעה</label>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              className="input w-full"
              rows={4}
              placeholder="כתוב את ההודעה שלך..."
            />
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">תצוגה מקדימה</label>
            <div className="p-4 bg-gray-50 rounded-lg border whitespace-pre-wrap text-sm">
              {preview}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
          >
            <X size={18} />
            ביטול
          </button>
          <button
            onClick={handleSend}
            disabled={
            !templateId ||
            sendMessage.isPending ||
            (needsCustomMessage && !customMessage) ||
            (needsMeeting && !selectedMeetingId)
          }
            className="btn btn-primary flex items-center gap-2"
          >
            {sendMessage.isPending ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                שולח...
              </>
            ) : (
              <>
                <Send size={18} />
                שלח {channel === 'whatsapp' ? 'וואטסאפ' : 'אימייל'}
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
