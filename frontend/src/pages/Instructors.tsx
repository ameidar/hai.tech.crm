import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Plus, UserCheck, Phone, Mail, RefreshCcw, Calendar, Send, Copy, Check, MessageCircle, Search, KeyRound } from 'lucide-react';
import { useInstructors, useCreateInstructor, useUpdateInstructor, useSendInstructorInvite, useResetInstructorPassword } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCardGrid } from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ViewSelector from '../components/ViewSelector';
import SendMessageModal from '../components/SendMessageModal';
import type { Instructor } from '../types';

export default function Instructors() {
  const [searchParams] = useSearchParams();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingInstructor, setEditingInstructor] = useState<Instructor | null>(null);
  const [inviteModal, setInviteModal] = useState<{ instructor: Instructor; url: string } | null>(null);
  const [resetPasswordModal, setResetPasswordModal] = useState<{ instructor: Instructor; url: string } | null>(null);
  const [messageInstructor, setMessageInstructor] = useState<Instructor | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  const { data: instructors, isLoading } = useInstructors();

  // Initialize search from URL params
  useEffect(() => {
    const search = searchParams.get('search');
    if (search) {
      setSearchFilter(search);
    }
  }, [searchParams]);

  // Filter instructors
  const filteredInstructors = instructors?.filter((instructor) => {
    if (!searchFilter) return true;
    const searchLower = searchFilter.toLowerCase();
    return (
      instructor.name.toLowerCase().includes(searchLower) ||
      instructor.phone?.includes(searchFilter) ||
      instructor.email?.toLowerCase().includes(searchLower)
    );
  });
  const createInstructor = useCreateInstructor();
  const updateInstructor = useUpdateInstructor();
  const sendInvite = useSendInstructorInvite();
  const resetPassword = useResetInstructorPassword();

  const handleSendInvite = async (instructor: Instructor) => {
    try {
      const result = await sendInvite.mutateAsync(instructor.id);
      setInviteModal({ instructor, url: result.inviteUrl });
    } catch (error) {
      console.error('Failed to generate invite:', error);
    }
  };

  const handleResetPassword = async (instructor: Instructor) => {
    try {
      const result = await resetPassword.mutateAsync(instructor.id);
      setResetPasswordModal({ instructor, url: result.resetUrl });
    } catch (error) {
      console.error('Failed to generate reset link:', error);
    }
  };

  const handleAddInstructor = async (data: Partial<Instructor>) => {
    try {
      await createInstructor.mutateAsync(data);
      setShowAddModal(false);
    } catch (error) {
      console.error('Failed to create instructor:', error);
    }
  };

  const handleUpdateInstructor = async (data: Partial<Instructor>) => {
    if (!editingInstructor) return;
    try {
      await updateInstructor.mutateAsync({ id: editingInstructor.id, data });
      setEditingInstructor(null);
    } catch (error) {
      console.error('Failed to update instructor:', error);
    }
  };

  return (
    <>
      <PageHeader
        title="מדריכים"
        subtitle={`${instructors?.length || 0} מדריכים`}
        actions={
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus size={18} />
            מדריך חדש
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Search & Views */}
        <div className="mb-4 flex gap-4 items-center">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="חיפוש מדריך..."
              className="form-input pr-10 w-full"
            />
          </div>
          <ViewSelector entity="instructors" onApplyView={() => {}} />
        </div>

        {isLoading ? (
          <SkeletonCardGrid count={6} />
        ) : filteredInstructors && filteredInstructors.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredInstructors.map((instructor) => (
              <InstructorCard
                key={instructor.id}
                instructor={instructor}
                onEdit={() => setEditingInstructor(instructor)}
                onSendInvite={() => handleSendInvite(instructor)}
                onSendMessage={() => setMessageInstructor(instructor)}
                onResetPassword={() => handleResetPassword(instructor)}
                isInviteLoading={sendInvite.isPending}
                isResetLoading={resetPassword.isPending}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<UserCheck size={40} />}
            title="אין מדריכים"
            description="עדיין לא נוספו מדריכים למערכת. הוסף מדריכים כדי לשייך אותם למחזורים!"
            action={
              <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                <Plus size={18} />
                הוסף מדריך ראשון
              </button>
            }
          />
        )}
      </div>

      {/* Add Instructor Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="מדריך חדש"
        size="lg"
      >
        <InstructorForm
          onSubmit={handleAddInstructor}
          onCancel={() => setShowAddModal(false)}
          isLoading={createInstructor.isPending}
        />
      </Modal>

      {/* Edit Instructor Modal */}
      <Modal
        isOpen={!!editingInstructor}
        onClose={() => setEditingInstructor(null)}
        title="עריכת מדריך"
        size="lg"
      >
        {editingInstructor && (
          <InstructorForm
            instructor={editingInstructor}
            onSubmit={handleUpdateInstructor}
            onCancel={() => setEditingInstructor(null)}
            isLoading={updateInstructor.isPending}
          />
        )}
      </Modal>

      {/* Invite Modal */}
      <Modal
        isOpen={!!inviteModal}
        onClose={() => setInviteModal(null)}
        title="שליחת הזמנה"
        size="md"
      >
        {inviteModal && (
          <InviteModalContent
            instructor={inviteModal.instructor}
            inviteUrl={inviteModal.url}
            onClose={() => setInviteModal(null)}
          />
        )}
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        isOpen={!!resetPasswordModal}
        onClose={() => setResetPasswordModal(null)}
        title="איפוס סיסמה"
        size="md"
      >
        {resetPasswordModal && (
          <ResetPasswordModalContent
            instructor={resetPasswordModal.instructor}
            resetUrl={resetPasswordModal.url}
            onClose={() => setResetPasswordModal(null)}
          />
        )}
      </Modal>

      {/* Send Message Modal */}
      <SendMessageModal
        instructor={messageInstructor}
        onClose={() => setMessageInstructor(null)}
      />
    </>
  );
}

// Instructor Card
interface InstructorCardProps {
  instructor: Instructor;
  onEdit: () => void;
  onSendInvite: () => void;
  onSendMessage: () => void;
  onResetPassword: () => void;
  isInviteLoading?: boolean;
  isResetLoading?: boolean;
}

function InstructorCard({ instructor, onEdit, onSendInvite, onSendMessage, onResetPassword, isInviteLoading, isResetLoading }: InstructorCardProps) {
  const hasAccount = !!instructor.userId;

  return (
    <div className="group bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all duration-200 hover:-translate-y-0.5">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-lg font-bold text-white">
                {instructor.name.charAt(0)}
              </span>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">{instructor.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className={`badge ${instructor.isActive ? 'badge-success' : 'badge-gray'}`}>
                  {instructor.isActive ? 'פעיל' : 'לא פעיל'}
                </span>
                {hasAccount && (
                  <span className="badge badge-info" title="יש חשבון במערכת">
                    <UserCheck size={12} className="me-1" />
                    מחובר
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2.5 text-sm mb-4">
          <p className="flex items-center gap-2.5 text-gray-600">
            <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">
              <Phone size={14} className="text-gray-500" />
            </div>
            <span dir="ltr" className="text-gray-700">{instructor.phone}</span>
          </p>
          <p className="flex items-center gap-2.5 text-gray-600">
            <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">
              <Mail size={14} className="text-gray-500" />
            </div>
            <span dir="ltr" className="truncate text-gray-700">{instructor.email}</span>
          </p>
        </div>

        {/* Rates */}
        <div className="grid grid-cols-4 gap-2 mb-4 p-3 bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl text-center border border-gray-100">
          <div className="p-1">
            <p className="text-xs text-gray-500 mb-0.5">פרונטלי</p>
            <p className="font-semibold text-gray-900">{instructor.rateFrontal != null ? `₪${instructor.rateFrontal}` : '-'}</p>
          </div>
          <div className="p-1">
            <p className="text-xs text-gray-500 mb-0.5">אונליין</p>
            <p className="font-semibold text-gray-900">{instructor.rateOnline != null ? `₪${instructor.rateOnline}` : '-'}</p>
          </div>
          <div className="p-1">
            <p className="text-xs text-gray-500 mb-0.5">פרטי</p>
            <p className="font-semibold text-gray-900">{instructor.ratePrivate != null ? `₪${instructor.ratePrivate}` : '-'}</p>
          </div>
          <div className="p-1">
            <p className="text-xs text-gray-500 mb-0.5">הכנה</p>
            <p className="font-semibold text-gray-900">{instructor.ratePreparation != null ? `₪${instructor.ratePreparation}` : '-'}</p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-gray-100 text-sm">
          <div className="flex items-center gap-4 text-gray-500">
            <Link 
              to={`/cycles?instructorId=${instructor.id}`}
              className="flex items-center gap-1.5 hover:text-blue-600 transition-colors group"
            >
              <RefreshCcw size={14} className="group-hover:text-blue-600" />
              <span className="group-hover:underline">{instructor._count?.cycles || 0} מחזורים</span>
            </Link>
            <Link 
              to={`/meetings?instructorId=${instructor.id}`}
              className="flex items-center gap-1.5 hover:text-blue-600 transition-colors group"
            >
              <Calendar size={14} className="group-hover:text-blue-600" />
              <span className="group-hover:underline">{instructor._count?.meetings || 0} פגישות</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {!hasAccount && (
              <button
                onClick={onSendInvite}
                disabled={isInviteLoading}
                className="text-green-600 hover:text-green-700 flex items-center gap-1.5 font-medium transition-colors"
                title="שלח הזמנה"
              >
                <Send size={14} />
                הזמנה
              </button>
            )}
            {hasAccount && (
              <button
                onClick={onResetPassword}
                disabled={isResetLoading}
                className="text-orange-600 hover:text-orange-700 flex items-center gap-1.5 font-medium transition-colors"
                title="איפוס סיסמה"
              >
                <KeyRound size={14} />
                איפוס
              </button>
            )}
            <button
              onClick={onSendMessage}
              className="text-green-600 hover:text-green-700 flex items-center gap-1.5 font-medium transition-colors"
              title="שלח הודעה"
            >
              <MessageCircle size={14} />
              הודעה
            </button>
            <button
              onClick={onEdit}
              className="text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors"
            >
              עריכה
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Invite Modal Content
interface InviteModalContentProps {
  instructor: Instructor;
  inviteUrl: string;
  onClose: () => void;
}

function InviteModalContent({ instructor, inviteUrl, onClose }: InviteModalContentProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleWhatsApp = () => {
    const message = encodeURIComponent(
      `שלום ${instructor.name},\n\nהוזמנת להצטרף למערכת HaiTech CRM.\n\nלחץ על הקישור כדי להשלים את ההרשמה:\n${inviteUrl}`
    );
    // Format phone number for WhatsApp (remove leading 0, add country code)
    let phone = instructor.phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) {
      phone = '972' + phone.substring(1);
    }
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
  };

  return (
    <div className="p-6">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Send className="text-green-600" size={28} />
        </div>
        <h3 className="text-lg font-semibold text-gray-800">
          הזמנה עבור {instructor.name}
        </h3>
        <p className="text-gray-500 text-sm mt-1">
          הקישור תקף ל-7 ימים
        </p>
      </div>

      {/* Link display */}
      <div className="bg-gray-50 rounded-lg p-3 mb-4">
        <p className="text-xs text-gray-500 mb-1">קישור ההזמנה:</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inviteUrl}
            readOnly
            dir="ltr"
            className="flex-1 bg-white border border-gray-200 rounded px-3 py-2 text-sm text-gray-700 font-mono"
          />
          <button
            onClick={handleCopy}
            className={`p-2 rounded transition-colors ${
              copied ? 'bg-green-100 text-green-600' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}
            title="העתק קישור"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-3">
        <button
          onClick={handleWhatsApp}
          className="w-full flex items-center justify-center gap-2 bg-green-500 text-white py-3 rounded-lg font-medium hover:bg-green-600 transition-colors"
        >
          <MessageCircle size={20} />
          שלח בוואטסאפ
        </button>
        
        <button
          onClick={handleCopy}
          className="w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors"
        >
          {copied ? <Check size={20} /> : <Copy size={20} />}
          {copied ? 'הועתק!' : 'העתק קישור'}
        </button>
      </div>

      <div className="mt-6 pt-4 border-t">
        <button
          onClick={onClose}
          className="w-full text-gray-500 hover:text-gray-700 text-sm"
        >
          סגור
        </button>
      </div>
    </div>
  );
}

// Reset Password Modal Content
interface ResetPasswordModalContentProps {
  instructor: Instructor;
  resetUrl: string;
  onClose: () => void;
}

function ResetPasswordModalContent({ instructor, resetUrl, onClose }: ResetPasswordModalContentProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(resetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleWhatsApp = () => {
    const message = encodeURIComponent(
      `שלום ${instructor.name},\n\nקיבלנו בקשה לאיפוס הסיסמה שלך במערכת HaiTech CRM.\n\nלחץ על הקישור כדי להגדיר סיסמה חדשה:\n${resetUrl}\n\nהקישור תקף ל-24 שעות.`
    );
    let phone = instructor.phone?.replace(/[^0-9]/g, '') || '';
    if (phone.startsWith('0')) {
      phone = '972' + phone.substring(1);
    }
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
  };

  return (
    <div className="p-6">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <KeyRound className="text-orange-600" size={28} />
        </div>
        <h3 className="text-lg font-semibold text-gray-800">
          איפוס סיסמה עבור {instructor.name}
        </h3>
        <p className="text-gray-500 text-sm mt-1">
          הקישור תקף ל-24 שעות
        </p>
      </div>

      {/* Link display */}
      <div className="bg-gray-50 rounded-lg p-3 mb-4">
        <p className="text-xs text-gray-500 mb-1">קישור לאיפוס:</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={resetUrl}
            readOnly
            dir="ltr"
            className="flex-1 bg-white border border-gray-200 rounded px-3 py-2 text-sm text-gray-700 font-mono"
          />
          <button
            onClick={handleCopy}
            className={`p-2 rounded transition-colors ${
              copied ? 'bg-green-100 text-green-600' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}
            title="העתק קישור"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-3">
        {instructor.phone && (
          <button
            onClick={handleWhatsApp}
            className="w-full flex items-center justify-center gap-2 bg-green-500 text-white py-3 rounded-lg font-medium hover:bg-green-600 transition-colors"
          >
            <MessageCircle size={20} />
            שלח בוואטסאפ
          </button>
        )}
        
        <button
          onClick={handleCopy}
          className="w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors"
        >
          {copied ? <Check size={20} /> : <Copy size={20} />}
          {copied ? 'הועתק!' : 'העתק קישור'}
        </button>
      </div>

      <div className="mt-6 pt-4 border-t">
        <button
          onClick={onClose}
          className="w-full text-gray-500 hover:text-gray-700 text-sm"
        >
          סגור
        </button>
      </div>
    </div>
  );
}

// Instructor Form
interface InstructorFormProps {
  instructor?: Instructor;
  onSubmit: (data: Partial<Instructor>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function InstructorForm({ instructor, onSubmit, onCancel, isLoading }: InstructorFormProps) {
  const [formData, setFormData] = useState({
    name: instructor?.name || '',
    phone: instructor?.phone || '',
    email: instructor?.email || '',
    rateFrontal: instructor?.rateFrontal || 150,
    rateOnline: instructor?.rateOnline || 120,
    ratePrivate: instructor?.ratePrivate || 150,
    ratePreparation: instructor?.ratePreparation || 50,
    notes: instructor?.notes || '',
    isActive: instructor?.isActive ?? true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      rateFrontal: Number(formData.rateFrontal),
      rateOnline: Number(formData.rateOnline),
      ratePrivate: Number(formData.ratePrivate),
      ratePreparation: Number(formData.ratePreparation),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="form-label">שם מלא *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="form-input"
            required
          />
        </div>

        <div>
          <label className="form-label">טלפון *</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className="form-input"
            dir="ltr"
            required
          />
        </div>

        <div>
          <label className="form-label">אימייל *</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="form-input"
            dir="ltr"
            required
          />
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-700 mb-4">תעריפים (לשעה)</h4>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="form-label">פרונטלי</label>
            <div className="relative">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
              <input
                type="number"
                value={formData.rateFrontal}
                onChange={(e) => setFormData({ ...formData, rateFrontal: Number(e.target.value) })}
                className="form-input pr-8"
                min="0"
              />
            </div>
          </div>

          <div>
            <label className="form-label">אונליין</label>
            <div className="relative">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
              <input
                type="number"
                value={formData.rateOnline}
                onChange={(e) => setFormData({ ...formData, rateOnline: Number(e.target.value) })}
                className="form-input pr-8"
                min="0"
              />
            </div>
          </div>

          <div>
            <label className="form-label">פרטי</label>
            <div className="relative">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
              <input
                type="number"
                value={formData.ratePrivate}
                onChange={(e) => setFormData({ ...formData, ratePrivate: Number(e.target.value) })}
                className="form-input pr-8"
                min="0"
              />
            </div>
          </div>

          <div>
            <label className="form-label">הכנה</label>
            <div className="relative">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
              <input
                type="number"
                value={formData.ratePreparation}
                onChange={(e) => setFormData({ ...formData, ratePreparation: Number(e.target.value) })}
                className="form-input pr-8"
                min="0"
              />
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className="form-label">הערות</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="form-input"
          rows={3}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isActive"
          checked={formData.isActive}
          onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="isActive" className="text-sm text-gray-700">
          מדריך פעיל
        </label>
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
