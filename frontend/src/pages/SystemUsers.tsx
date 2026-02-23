import { useState } from 'react';
import {
  Plus,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Trash2,
  Edit,
  Copy,
  Check,
  Search,
  UserCog,
  Send,
  MessageCircle,
} from 'lucide-react';
import {
  useSystemUsers,
  useCreateSystemUser,
  useUpdateSystemUser,
  useDeleteSystemUser,
  useResetSystemUserPassword,
} from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Modal from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import type { User } from '../types';

const ROLE_LABELS: Record<string, string> = {
  admin: 'מנהל מערכת',
  manager: 'מנהל',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  manager: 'bg-blue-100 text-blue-700',
};

// ===== Invite / Reset Modal =====
interface LinkModalProps {
  type: 'invite' | 'reset';
  user: { name: string; email: string; phone?: string | null };
  url: string;
  onClose: () => void;
}

function LinkModal({ type, user, url, onClose }: LinkModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {/* ignore */}
  };

  const handleWhatsApp = () => {
    const isInvite = type === 'invite';
    const message = isInvite
      ? encodeURIComponent(
          `שלום ${user.name},\n\nהוזמנת להצטרף למערכת HaiTech CRM.\n\nלחץ על הקישור כדי להגדיר את הסיסמה שלך:\n${url}\n\nהקישור תקף ל-7 ימים.`
        )
      : encodeURIComponent(
          `שלום ${user.name},\n\nהתקבלה בקשה לאיפוס הסיסמה שלך במערכת HaiTech CRM.\n\nלחץ על הקישור כדי להגדיר סיסמה חדשה:\n${url}\n\nהקישור תקף ל-24 שעות.`
        );

    let phone = (user.phone || '').replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '972' + phone.substring(1);

    if (phone) {
      window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
    } else {
      // No phone — open WhatsApp without a number (user can choose contact)
      window.open(`https://wa.me/?text=${message}`, '_blank');
    }
  };

  const isInvite = type === 'invite';

  return (
    <div className="p-6">
      <div className="text-center mb-6">
        <div className={`w-16 h-16 ${isInvite ? 'bg-green-100' : 'bg-orange-100'} rounded-full flex items-center justify-center mx-auto mb-4`}>
          {isInvite
            ? <Send className="text-green-600" size={28} />
            : <KeyRound className="text-orange-600" size={28} />
          }
        </div>
        <h3 className="text-lg font-semibold text-gray-800">
          {isInvite ? `הזמנה עבור ${user.name}` : `איפוס סיסמה עבור ${user.name}`}
        </h3>
        <p className="text-gray-500 text-sm mt-1">
          {isInvite ? 'הקישור תקף ל-7 ימים' : 'הקישור תקף ל-24 שעות'}
        </p>
      </div>

      {/* Link */}
      <div className="bg-gray-50 rounded-lg p-3 mb-4">
        <p className="text-xs text-gray-500 mb-1">
          {isInvite ? 'קישור ההזמנה:' : 'קישור לאיפוס:'}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={url}
            readOnly
            dir="ltr"
            className="flex-1 bg-white border border-gray-200 rounded px-3 py-2 text-sm text-gray-700 font-mono min-w-0"
          />
          <button
            onClick={handleCopy}
            className={`flex-shrink-0 p-2 rounded transition-colors ${
              copied ? 'bg-green-100 text-green-600' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}
            title="העתק קישור"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
      </div>

      {/* Actions */}
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
        <button onClick={onClose} className="w-full text-gray-500 hover:text-gray-700 text-sm">
          סגור
        </button>
      </div>
    </div>
  );
}

// ===== Main Page =====
export default function SystemUsers() {
  const { user: currentUser } = useAuth();
  const { data: users, isLoading } = useSystemUsers();

  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<User | null>(null);
  const [linkModal, setLinkModal] = useState<{
    type: 'invite' | 'reset';
    user: { name: string; email: string; phone?: string | null };
    url: string;
  } | null>(null);

  const createUser = useCreateSystemUser();
  const updateUser = useUpdateSystemUser();
  const deleteUser = useDeleteSystemUser();
  const resetPassword = useResetSystemUserPassword();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'manager' as 'admin' | 'manager',
  });
  const [formError, setFormError] = useState('');

  const filtered = (users || []).filter((u) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s);
  });

  const isAdmin = currentUser?.role === 'admin';

  const openAdd = () => {
    setFormData({ name: '', email: '', phone: '', role: 'manager' });
    setFormError('');
    setShowAddModal(true);
  };

  const openEdit = (u: User) => {
    setFormData({ name: u.name, email: u.email, phone: u.phone || '', role: u.role as 'admin' | 'manager' });
    setFormError('');
    setEditingUser(u);
  };

  const handleCreate = async () => {
    setFormError('');
    if (!formData.name || !formData.email) {
      setFormError('שם ואימייל הם שדות חובה');
      return;
    }
    try {
      const result = await createUser.mutateAsync({
        name: formData.name,
        email: formData.email,
        phone: formData.phone || undefined,
        role: formData.role,
      });
      setShowAddModal(false);
      // Show invite link modal
      setLinkModal({
        type: 'invite',
        user: { name: result.name, email: result.email, phone: result.phone },
        url: result.inviteUrl,
      });
    } catch (err: any) {
      setFormError(err?.response?.data?.error || err?.message || 'שגיאה ביצירת משתמש');
    }
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    setFormError('');
    try {
      await updateUser.mutateAsync({
        id: editingUser.id,
        data: {
          name: formData.name,
          phone: formData.phone || undefined,
          role: formData.role,
        },
      });
      setEditingUser(null);
    } catch (err: any) {
      setFormError(err?.response?.data?.error || err?.message || 'שגיאה בעדכון משתמש');
    }
  };

  const handleToggleActive = async (u: User) => {
    try {
      await updateUser.mutateAsync({ id: u.id, data: { isActive: !u.isActive } });
    } catch (err: any) {
      alert(err?.response?.data?.error || 'שגיאה בעדכון סטטוס');
    }
  };

  const handleResetPassword = async (u: User) => {
    try {
      const result = await resetPassword.mutateAsync(u.id);
      setLinkModal({
        type: 'reset',
        user: { name: result.user.name, email: result.user.email, phone: result.user.phone },
        url: result.resetUrl,
      });
    } catch (err: any) {
      alert(err?.response?.data?.error || 'שגיאה באיפוס סיסמה');
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteUser.mutateAsync(deleteConfirm.id);
      setDeleteConfirm(null);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'שגיאה במחיקת משתמש');
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex-1 p-8 flex items-center justify-center">
        <div className="text-center text-slate-500">
          <ShieldAlert size={48} className="mx-auto mb-4 text-red-400" />
          <p className="text-lg font-medium">גישה מוגבלת</p>
          <p>רק מנהלי מערכת יכולים לגשת לדף זה</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <PageHeader
        title="ניהול הנהלה"
        subtitle="ניהול משתמשי המערכת — מנהלים ומנהלי מערכת"
        actions={
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={18} />
            הוספת משתמש
          </button>
        }
      />

      {/* Search */}
      <div className="px-6 py-4 border-b border-slate-200">
        <div className="relative max-w-sm">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם או אימייל..."
            className="w-full pl-4 pr-10 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <UserCog size={48} className="mx-auto mb-4 opacity-30" />
            <p>אין משתמשי הנהלה</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">שם</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">אימייל</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">טלפון</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">תפקיד</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">סטטוס</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">כניסה אחרונה</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((u) => (
                  <tr key={u.id} className={`hover:bg-slate-50 transition-colors ${!u.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {u.name.charAt(0)}
                        </div>
                        {u.name}
                        {u.id === currentUser?.id && (
                          <span className="text-xs text-slate-400">(אתה)</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                    <td className="px-4 py-3 text-slate-600">{u.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] || 'bg-slate-100 text-slate-600'}`}>
                        <ShieldCheck size={12} />
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(u)}
                        disabled={u.id === currentUser?.id}
                        className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                          u.isActive
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        } disabled:cursor-not-allowed`}
                      >
                        {u.isActive ? 'פעיל' : 'לא פעיל'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {u.lastLogin
                        ? new Date(u.lastLogin).toLocaleString('he-IL', {
                            timeZone: 'Asia/Jerusalem',
                            day: '2-digit',
                            month: '2-digit',
                            year: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'אף פעם'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => openEdit(u)}
                          title="עריכה"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <Edit size={15} />
                        </button>
                        <button
                          onClick={() => handleResetPassword(u)}
                          title="איפוס סיסמה"
                          disabled={resetPassword.isPending}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-40"
                        >
                          <KeyRound size={15} />
                        </button>
                        {u.id !== currentUser?.id && (
                          <button
                            onClick={() => setDeleteConfirm(u)}
                            title="מחיקה"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      <Modal
        isOpen={showAddModal || !!editingUser}
        onClose={() => { setShowAddModal(false); setEditingUser(null); }}
        title={editingUser ? `עריכת ${editingUser.name}` : 'הוספת משתמש הנהלה'}
      >
        <div className="space-y-4 mt-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">שם מלא *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="שם מלא"
            />
          </div>

          {!editingUser && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">אימייל *</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="user@example.com"
                dir="ltr"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">טלפון</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="050-0000000"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">תפקיד</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData((p) => ({ ...p, role: e.target.value as 'admin' | 'manager' }))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="manager">מנהל</option>
              <option value="admin">מנהל מערכת</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">
              מנהל מערכת — גישה מלאה כולל ניהול משתמשים. מנהל — גישה לכל המידע ללא ניהול משתמשים.
            </p>
          </div>

          {!editingUser && (
            <div className="p-3 bg-blue-50 text-blue-700 rounded-lg text-xs">
              לאחר היצירה תקבל קישור הזמנה לשליחה בוואטסאפ — המשתמש יגדיר סיסמה עצמאית.
            </div>
          )}

          {formError && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{formError}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={editingUser ? handleUpdate : handleCreate}
              disabled={createUser.isPending || updateUser.isPending}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
            >
              {editingUser ? 'שמירה' : 'צור וקבל קישור'}
            </button>
            <button
              onClick={() => { setShowAddModal(false); setEditingUser(null); }}
              className="flex-1 py-2.5 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              ביטול
            </button>
          </div>
        </div>
      </Modal>

      {/* Invite / Reset Link Modal */}
      <Modal
        isOpen={!!linkModal}
        onClose={() => setLinkModal(null)}
        title={linkModal?.type === 'invite' ? 'שליחת הזמנה' : 'איפוס סיסמה'}
      >
        {linkModal && (
          <LinkModal
            type={linkModal.type}
            user={linkModal.user}
            url={linkModal.url}
            onClose={() => setLinkModal(null)}
          />
        )}
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="מחיקת משתמש"
      >
        {deleteConfirm && (
          <div className="mt-2 space-y-4">
            <p className="text-slate-600">
              האם למחוק את <span className="font-medium">{deleteConfirm.name}</span> ({deleteConfirm.email})?
              <br />
              <span className="text-red-500 text-sm">פעולה זו אינה ניתנת לשחזור.</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleteUser.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50"
              >
                מחיקה
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                ביטול
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
