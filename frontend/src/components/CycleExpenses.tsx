import { useState } from 'react';
import { Plus, Trash2, Clock, Package, Users, MoreHorizontal, Percent, Pencil, X } from 'lucide-react';
import { 
  useCycleExpenses, 
  useCreateCycleExpense, 
  useUpdateCycleExpense,
  useDeleteCycleExpense,
} from '../hooks/useExpenses';
import { useInstructors } from '../hooks/useApi';
import type { CycleExpense } from '../hooks/useExpenses';

interface CycleExpensesProps {
  cycleId: string;
  totalMeetings: number;
  meetingRevenue: number;
  isAdmin: boolean;
}

const expenseTypeLabels: Record<CycleExpense['type'], string> = {
  materials: 'הכנת חומרים',
  wraparound_hours: 'שעות עוטפות',
  equipment: 'ציוד',
  travel_fixed: 'נסיעות קבוע',
  additional_instructor: 'מדריך נוסף',
  other: 'אחר',
};

const expenseTypeIcons: Record<CycleExpense['type'], React.ReactNode> = {
  materials: <Package size={16} />,
  wraparound_hours: <Clock size={16} />,
  equipment: <Package size={16} />,
  travel_fixed: <Package size={16} />,
  additional_instructor: <Users size={16} />,
  other: <MoreHorizontal size={16} />,
};

const rateTypeLabels: Record<string, string> = {
  preparation: 'הכנת חומרים',
  online: 'אונליין',
  frontal: 'פרונטלי',
};

export default function CycleExpenses({ cycleId, totalMeetings, meetingRevenue, isAdmin }: CycleExpensesProps) {
  const { data: expenses, isLoading } = useCycleExpenses(cycleId);
  const { data: instructors } = useInstructors();
  const createExpense = useCreateCycleExpense();
  const deleteExpense = useDeleteCycleExpense();

  const updateExpense = useUpdateCycleExpense();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    type: 'other' as CycleExpense['type'],
    description: '',
    amount: '',
    isPercentage: false,
    percentage: '',
    hours: '',
    rateType: 'preparation' as 'preparation' | 'online' | 'frontal',
    instructorId: '',
  });
  const [newExpense, setNewExpense] = useState({
    type: 'wraparound_hours' as CycleExpense['type'],
    description: '',
    amount: '',
    isPercentage: false,
    percentage: '',
    hours: '',
    rateType: 'preparation' as 'preparation' | 'online' | 'frontal',
    instructorId: '',
  });

  const handleAdd = async () => {
    try {
      if (newExpense.isPercentage) {
        if (!newExpense.percentage || Number(newExpense.percentage) <= 0) return;
        await createExpense.mutateAsync({
          cycleId,
          type: newExpense.type,
          description: newExpense.description || undefined,
          isPercentage: true,
          percentage: Number(newExpense.percentage),
        });
      } else if (newExpense.hours && newExpense.instructorId) {
        await createExpense.mutateAsync({
          cycleId,
          type: newExpense.type,
          description: newExpense.description || undefined,
          hours: Number(newExpense.hours),
          rateType: newExpense.rateType,
          instructorId: newExpense.instructorId,
        });
      } else if (newExpense.amount) {
        await createExpense.mutateAsync({
          cycleId,
          type: newExpense.type,
          description: newExpense.description || undefined,
          amount: Number(newExpense.amount),
        });
      } else {
        return;
      }
      setNewExpense({ type: 'wraparound_hours', description: '', amount: '', isPercentage: false, percentage: '', hours: '', rateType: 'preparation', instructorId: '' });
      setShowAddForm(false);
    } catch (error) {
      console.error('Failed to add expense:', error);
    }
  };

  const handleStartEdit = (expense: CycleExpense) => {
    setEditingId(expense.id);
    setEditForm({
      type: expense.type,
      description: expense.description || '',
      amount: expense.amount ? String(expense.amount) : '',
      isPercentage: expense.isPercentage || false,
      percentage: expense.percentage ? String(expense.percentage) : '',
      hours: expense.hours ? String(expense.hours) : '',
      rateType: (expense.rateType as 'preparation' | 'online' | 'frontal') || 'preparation',
      instructorId: expense.instructorId || '',
    });
  };

  const handleUpdate = async (id: string) => {
    try {
      await updateExpense.mutateAsync({
        id,
        cycleId,
        type: editForm.type,
        description: editForm.description || undefined,
        amount: editForm.amount ? Number(editForm.amount) : undefined,
        isPercentage: editForm.isPercentage,
        percentage: editForm.percentage ? Number(editForm.percentage) : undefined,
        hours: editForm.hours ? Number(editForm.hours) : undefined,
        rateType: editForm.hours ? editForm.rateType : undefined,
        instructorId: editForm.instructorId || undefined,
      });
      setEditingId(null);
    } catch (error) {
      console.error('Failed to update expense:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('האם למחוק הוצאה זו?')) return;
    try {
      await deleteExpense.mutateAsync({ id, cycleId });
    } catch (error) {
      console.error('Failed to delete expense:', error);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  if (isLoading) {
    return <div className="text-center py-4 text-gray-500">טוען...</div>;
  }

  const expensesList = Array.isArray(expenses) ? expenses : [];
  
  // Calculate total expenses (handle percentage-based ones)
  const calculateExpenseAmount = (expense: CycleExpense): number => {
    if (expense.isPercentage && expense.percentage) {
      return (Number(expense.percentage) / 100) * meetingRevenue * totalMeetings;
    }
    return Number(expense.amount || 0);
  };

  const totalExpenses = expensesList.reduce((sum, e) => sum + calculateExpenseAmount(e), 0);
  const expensePerMeeting = totalMeetings > 0 ? totalExpenses / totalMeetings : 0;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-gray-50 p-3 rounded-lg grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-gray-500">סה"כ הוצאות מחזור:</span>
          <span className="font-bold text-gray-900 mr-1">{formatCurrency(totalExpenses)}</span>
        </div>
        <div>
          <span className="text-gray-500">לפגישה:</span>
          <span className="font-bold text-orange-600 mr-1">{formatCurrency(expensePerMeeting)}</span>
        </div>
      </div>

      {/* Expenses List */}
      {expensesList.length > 0 ? (
        <div className="space-y-2">
          {expensesList.map((expense) => (
            <div key={expense.id} className="p-3 border rounded-lg">
              {editingId === expense.id ? (
                /* Inline edit form */
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">סוג</label>
                      <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value as CycleExpense['type'] })} className="input w-full text-sm">
                        {Object.entries(expenseTypeLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">תיאור</label>
                      <input type="text" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="input w-full text-sm" placeholder="תיאור (אופציונלי)" />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-1 text-sm"><input type="radio" checked={!editForm.isPercentage && !editForm.hours} onChange={() => setEditForm({ ...editForm, isPercentage: false, hours: '' })} /> סכום קבוע</label>
                    <label className="flex items-center gap-1 text-sm"><input type="radio" checked={!!editForm.hours} onChange={() => setEditForm({ ...editForm, isPercentage: false, hours: '1' })} /> לפי שעות</label>
                    <label className="flex items-center gap-1 text-sm"><input type="radio" checked={editForm.isPercentage} onChange={() => setEditForm({ ...editForm, isPercentage: true, hours: '' })} /> אחוז</label>
                  </div>
                  {!editForm.isPercentage && !editForm.hours && (
                    <input type="number" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} className="input w-full text-sm" placeholder="סכום ₪" />
                  )}
                  {!!editForm.hours && (
                    <div className="grid grid-cols-3 gap-2">
                      <input type="number" step="0.5" value={editForm.hours} onChange={(e) => setEditForm({ ...editForm, hours: e.target.value })} className="input text-sm" placeholder="שעות" />
                      <select value={editForm.instructorId} onChange={(e) => setEditForm({ ...editForm, instructorId: e.target.value })} className="input text-sm">
                        <option value="">מדריך</option>
                        {instructors?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                      <select value={editForm.rateType} onChange={(e) => setEditForm({ ...editForm, rateType: e.target.value as 'preparation' | 'online' | 'frontal' })} className="input text-sm">
                        {Object.entries(rateTypeLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  )}
                  {editForm.isPercentage && (
                    <div className="flex items-center gap-2">
                      <input type="number" value={editForm.percentage} onChange={(e) => setEditForm({ ...editForm, percentage: e.target.value })} className="input w-20 text-sm" placeholder="%" />
                      <span className="text-sm text-gray-500">% מהכנסת המחזור</span>
                    </div>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className="btn btn-secondary btn-sm flex items-center gap-1"><X size={14} /> ביטול</button>
                    <button onClick={() => handleUpdate(expense.id)} disabled={updateExpense.isPending} className="btn btn-primary btn-sm">שמור</button>
                  </div>
                </div>
              ) : (
                /* Normal view */
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400">{expenseTypeIcons[expense.type]}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{expenseTypeLabels[expense.type]}</span>
                        {expense.instructor && <span className="text-sm text-blue-600">({expense.instructor.name})</span>}
                      </div>
                      {expense.description && <p className="text-sm text-gray-500">{expense.description}</p>}
                      {expense.hours && expense.rateType && (
                        <p className="text-xs text-gray-400">
                          {expense.hours} שעות × תעריף {rateTypeLabels[expense.rateType]}
                          {expense.instructor?.employmentType === 'employee' && ' × 1.3 (עלות מעסיק)'}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {expense.isPercentage ? (
                      <span className="font-bold flex items-center gap-1">
                        <Percent size={14} />{expense.percentage}%
                        <span className="text-sm text-gray-500">({formatCurrency(calculateExpenseAmount(expense))})</span>
                      </span>
                    ) : (
                      <span className="font-bold">{formatCurrency(Number(expense.amount || 0))}</span>
                    )}
                    {isAdmin && (
                      <>
                        <button onClick={() => handleStartEdit(expense)} className="text-gray-400 hover:text-blue-600 p-1" title="ערוך">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => handleDelete(expense.id)} className="text-gray-400 hover:text-red-600 p-1" title="מחק">
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-center text-gray-500 py-4">אין הוצאות מחזור</p>
      )}

      {/* Add Form */}
      {isAdmin && (
        <>
          {showAddForm ? (
            <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">סוג</label>
                  <select
                    value={newExpense.type}
                    onChange={(e) => setNewExpense({ ...newExpense, type: e.target.value as CycleExpense['type'] })}
                    className="input w-full"
                  >
                    {Object.entries(expenseTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">תיאור</label>
                  <input
                    type="text"
                    placeholder="תיאור (אופציונלי)"
                    value={newExpense.description}
                    onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                    className="input w-full"
                  />
                </div>
              </div>

              {/* Calculation method */}
              <div className="space-y-2">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={!newExpense.isPercentage && !newExpense.hours}
                      onChange={() => setNewExpense({ ...newExpense, isPercentage: false, hours: '', instructorId: '' })}
                    />
                    <span className="text-sm">סכום קבוע</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={!!newExpense.hours}
                      onChange={() => setNewExpense({ ...newExpense, isPercentage: false, amount: '', hours: '1' })}
                    />
                    <span className="text-sm">לפי שעות ותעריף</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={newExpense.isPercentage}
                      onChange={() => setNewExpense({ ...newExpense, isPercentage: true, amount: '', hours: '', instructorId: '' })}
                    />
                    <span className="text-sm">אחוז מהכנסה</span>
                  </label>
                </div>

                {/* Fixed amount */}
                {!newExpense.isPercentage && !newExpense.hours && (
                  <input
                    type="number"
                    placeholder="סכום ₪"
                    value={newExpense.amount}
                    onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                    className="input w-full"
                  />
                )}

                {/* Hours and rate */}
                {!!newExpense.hours && (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">שעות</label>
                      <input
                        type="number"
                        step="0.5"
                        value={newExpense.hours}
                        onChange={(e) => setNewExpense({ ...newExpense, hours: e.target.value })}
                        className="input w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">מדריך</label>
                      <select
                        value={newExpense.instructorId}
                        onChange={(e) => setNewExpense({ ...newExpense, instructorId: e.target.value })}
                        className="input w-full"
                      >
                        <option value="">בחר מדריך</option>
                        {instructors?.map((instructor) => (
                          <option key={instructor.id} value={instructor.id}>
                            {instructor.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">תעריף</label>
                      <select
                        value={newExpense.rateType}
                        onChange={(e) => setNewExpense({ ...newExpense, rateType: e.target.value as 'preparation' | 'online' | 'frontal' })}
                        className="input w-full"
                      >
                        {Object.entries(rateTypeLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Percentage */}
                {newExpense.isPercentage && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="אחוז"
                      value={newExpense.percentage}
                      onChange={(e) => setNewExpense({ ...newExpense, percentage: e.target.value })}
                      className="input w-24"
                    />
                    <span className="text-gray-500">% מהכנסת המחזור</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="btn btn-secondary btn-sm"
                >
                  ביטול
                </button>
                <button
                  onClick={handleAdd}
                  disabled={createExpense.isPending}
                  className="btn btn-primary btn-sm"
                >
                  {createExpense.isPending ? 'מוסיף...' : 'הוסף'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="btn btn-secondary btn-sm w-full flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              הוסף הוצאת מחזור
            </button>
          )}
        </>
      )}
    </div>
  );
}
