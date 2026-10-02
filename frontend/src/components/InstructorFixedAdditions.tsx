import { useState } from 'react';
import { Plus, Pencil, Trash2, CalendarX, X, Check } from 'lucide-react';
import {
  useInstructorFixedAdditions,
  useCreateInstructorFixedAddition,
  useUpdateInstructorFixedAddition,
  useDeleteInstructorFixedAddition,
  type InstructorFixedAddition,
  type InstructorFixedAdditionInput,
} from '../hooks/useApi';

interface InstructorFixedAdditionsProps {
  instructorId: string;
  employmentType?: string;
}

const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const monthLabel = (month: string | null) => {
  if (!month) return 'ללא הגבלה';
  const [y, m] = month.split('-').map(Number);
  return `${HEBREW_MONTHS[m - 1]} ${y}`;
};

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const statusBadge: Record<InstructorFixedAddition['status'], { label: string; className: string }> = {
  active: { label: 'פעיל', className: 'bg-green-100 text-green-700' },
  future: { label: 'מתחיל בעתיד', className: 'bg-blue-100 text-blue-700' },
  ended:  { label: 'הסתיים', className: 'bg-gray-100 text-gray-600' },
};

const apiErrorMessage = (error: unknown, fallback: string) => {
  const data = (error as { response?: { data?: { error?: string; details?: { message: string }[] } } })?.response?.data;
  return data?.details?.[0]?.message || data?.error || fallback;
};

type FormState = {
  description: string;
  amount: string;
  isNet: boolean;
  startMonth: string;
  endMonth: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  description: 'ריכוז',
  amount: '',
  isNet: true,
  startMonth: currentMonth(),
  endMonth: '',
  notes: '',
});

export default function InstructorFixedAdditions({ instructorId, employmentType }: InstructorFixedAdditionsProps) {
  const { data: additions, isLoading, error: loadError } = useInstructorFixedAdditions(instructorId);
  const createAddition = useCreateInstructorFixedAddition();
  const updateAddition = useUpdateInstructorFixedAddition();
  const deleteAddition = useDeleteInstructorFixedAddition();

  const [editing, setEditing] = useState<InstructorFixedAddition | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [endingId, setEndingId] = useState<string | null>(null);
  const [endMonthInput, setEndMonthInput] = useState(currentMonth());
  const [error, setError] = useState<string | null>(null);

  const openNew = () => {
    setForm(emptyForm());
    setEditing('new');
    setError(null);
  };

  const openEdit = (a: InstructorFixedAddition) => {
    setForm({
      description: a.description,
      amount: String(a.amount),
      isNet: a.isNet,
      startMonth: a.startMonth,
      endMonth: a.endMonth ?? '',
      notes: a.notes ?? '',
    });
    setEditing(a);
    setError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = Number(form.amount);
    if (!form.description.trim()) return setError('יש להזין תיאור');
    if (!(amount > 0)) return setError('הסכום חייב להיות גדול מ-0');
    if (!form.startMonth) return setError('יש לבחור חודש התחלה');
    if (form.endMonth && form.endMonth < form.startMonth) return setError('חודש הסיום חייב להיות זהה או מאוחר מחודש ההתחלה');

    const data: InstructorFixedAdditionInput = {
      description: form.description.trim(),
      amount,
      isNet: form.isNet,
      startMonth: form.startMonth,
      endMonth: form.endMonth || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editing === 'new') {
        await createAddition.mutateAsync({ instructorId, data });
      } else if (editing) {
        await updateAddition.mutateAsync({ instructorId, additionId: editing.id, data });
      }
      setEditing(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'שגיאה בשמירת התוספת'));
    }
  };

  const handleEnd = async (a: InstructorFixedAddition) => {
    setError(null);
    if (endMonthInput < a.startMonth) {
      setError('חודש הסיום חייב להיות זהה או מאוחר מחודש ההתחלה');
      return;
    }
    try {
      await updateAddition.mutateAsync({ instructorId, additionId: a.id, data: { endMonth: endMonthInput } });
      setEndingId(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'שגיאה בסיום התוספת'));
    }
  };

  const handleDelete = async (a: InstructorFixedAddition) => {
    if (!window.confirm(`למחוק את התוספת "${a.description}"? התוספת לא תופיע יותר בדוחות השכר.`)) return;
    setError(null);
    try {
      await deleteAddition.mutateAsync({ instructorId, additionId: a.id });
    } catch (err) {
      setError(apiErrorMessage(err, 'שגיאה במחיקת התוספת'));
    }
  };

  const isSaving = createAddition.isPending || updateAddition.isPending;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="font-medium text-gray-800">תוספות קבועות</h4>
          <p className="text-xs text-gray-500 mt-1">
            תשלום חודשי קבוע (למשל ריכוז) שנכלל אוטומטית בדוח השכר החודשי בכל חודש בטווח.
            {employmentType === 'employee' && ' בדוח מוצג הסכום כפי שהוזן (ללא עלות מעסיק ×1.3).'}
          </p>
        </div>
        {editing === null && (
          <button type="button" onClick={openNew} className="btn btn-primary flex items-center gap-1 whitespace-nowrap">
            <Plus size={16} />
            הוסף תוספת
          </button>
        )}
      </div>

      {error && <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}

      {editing !== null && (
        <form onSubmit={handleSave} className="border border-blue-200 bg-blue-50/50 rounded-lg p-4 space-y-3">
          <div className="font-medium text-blue-900 text-sm">{editing === 'new' ? 'תוספת קבועה חדשה' : 'עריכת תוספת קבועה'}</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">תיאור *</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="form-input"
                placeholder="ריכוז"
                required
              />
            </div>
            <div>
              <label className="form-label">סכום חודשי *</label>
              <div className="relative">
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
                <input
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="form-input pr-8"
                  min="0.01"
                  step="0.01"
                  required
                />
              </div>
            </div>
            <div className="col-span-2">
              <label className="form-label">סוג סכום</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" name="fixedAdditionIsNet" checked={form.isNet} onChange={() => setForm({ ...form, isNet: true })} />
                  <span className="text-sm">נטו</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="fixedAdditionIsNet" checked={!form.isNet} onChange={() => setForm({ ...form, isNet: false })} />
                  <span className="text-sm">ברוטו</span>
                </label>
              </div>
            </div>
            <div>
              <label className="form-label">מחודש *</label>
              <input
                type="month"
                value={form.startMonth}
                onChange={(e) => setForm({ ...form, startMonth: e.target.value })}
                className="form-input"
                dir="ltr"
                required
              />
            </div>
            <div>
              <label className="form-label">עד חודש (כולל)</label>
              <input
                type="month"
                value={form.endMonth}
                onChange={(e) => setForm({ ...form, endMonth: e.target.value })}
                className="form-input"
                dir="ltr"
              />
              <p className="text-xs text-gray-400 mt-1">ריק = ללא הגבלה</p>
            </div>
            <div className="col-span-2">
              <label className="form-label">הערות</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="form-input"
                rows={2}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="btn btn-secondary">ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'שומר...' : 'שמור'}</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-sm text-gray-500 p-4 text-center">טוען...</div>
      ) : loadError ? (
        <div className="text-sm text-red-600 p-4 text-center">{apiErrorMessage(loadError, 'שגיאה בטעינת התוספות הקבועות')}</div>
      ) : !additions || additions.length === 0 ? (
        <div className="text-sm text-gray-500 p-6 text-center border border-dashed rounded-lg">אין תוספות קבועות למדריך זה</div>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-right p-2.5 font-medium text-gray-600">תיאור</th>
                <th className="text-center p-2.5 font-medium text-gray-600">סכום</th>
                <th className="text-center p-2.5 font-medium text-gray-600">נטו/ברוטו</th>
                <th className="text-center p-2.5 font-medium text-gray-600">מחודש</th>
                <th className="text-center p-2.5 font-medium text-gray-600">עד חודש</th>
                <th className="text-center p-2.5 font-medium text-gray-600">סטטוס</th>
                <th className="text-center p-2.5 font-medium text-gray-600">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {additions.map((a) => (
                <tr key={a.id} className="border-t align-top">
                  <td className="p-2.5 text-gray-800 font-medium">
                    {a.description}
                    {a.notes && <div className="text-xs text-gray-400 font-normal">{a.notes}</div>}
                  </td>
                  <td className="p-2.5 text-center text-gray-800 font-semibold">₪{a.amount.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</td>
                  <td className="p-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${a.isNet ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {a.isNet ? 'נטו' : 'ברוטו'}
                    </span>
                  </td>
                  <td className="p-2.5 text-center text-gray-700">{monthLabel(a.startMonth)}</td>
                  <td className="p-2.5 text-center text-gray-700">{monthLabel(a.endMonth)}</td>
                  <td className="p-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${statusBadge[a.status].className}`}>{statusBadge[a.status].label}</span>
                  </td>
                  <td className="p-2.5 text-center">
                    {endingId === a.id ? (
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="month"
                          value={endMonthInput}
                          onChange={(e) => setEndMonthInput(e.target.value)}
                          className="form-input py-1 text-xs w-36"
                          dir="ltr"
                          title="חודש אחרון (כולל) לתשלום"
                        />
                        <button type="button" onClick={() => handleEnd(a)} className="text-green-600 hover:text-green-800" title="אשר סיום" disabled={updateAddition.isPending}>
                          <Check size={16} />
                        </button>
                        <button type="button" onClick={() => setEndingId(null)} className="text-gray-400 hover:text-gray-600" title="ביטול">
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2">
                        <button type="button" onClick={() => openEdit(a)} className="text-blue-600 hover:text-blue-800" title="עריכה">
                          <Pencil size={15} />
                        </button>
                        {a.status !== 'ended' && (
                          <button
                            type="button"
                            onClick={() => { setEndingId(a.id); setEndMonthInput(a.startMonth > currentMonth() ? a.startMonth : currentMonth()); setError(null); }}
                            className="text-amber-600 hover:text-amber-800 flex items-center gap-0.5 text-xs"
                            title="סיים — קבע חודש אחרון לתשלום"
                          >
                            <CalendarX size={15} />
                            סיים
                          </button>
                        )}
                        <button type="button" onClick={() => handleDelete(a)} className="text-red-500 hover:text-red-700" title="מחק" disabled={deleteAddition.isPending}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
