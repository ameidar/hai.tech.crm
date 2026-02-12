import { useState, useEffect } from 'react';
import { Plus, Trash2, Car, Users, Package, MoreHorizontal } from 'lucide-react';
import { 
  useMeetingExpenses, 
  useCreateMeetingExpense, 
  useDeleteMeetingExpense,
} from '../hooks/useExpenses';
import { useInstructors, useMeeting } from '../hooks/useApi';
import type { MeetingExpense } from '../hooks/useExpenses';

interface MeetingExpensesProps {
  meetingId: string;
  isAdmin: boolean;
  canSubmit: boolean;
}

const expenseTypeLabels: Record<MeetingExpense['type'], string> = {
  travel: 'נסיעות',
  taxi: 'מונית',
  extra_instructor: 'מדריך נוסף',
  materials: 'חומרים',
  other: 'אחר',
};

const expenseTypeIcons: Record<MeetingExpense['type'], React.ReactNode> = {
  travel: <Car size={16} />,
  taxi: <Car size={16} />,
  extra_instructor: <Users size={16} />,
  materials: <Package size={16} />,
  other: <MoreHorizontal size={16} />,
};

const rateTypeLabels: Record<string, string> = {
  preparation: 'תומך/הכנת חומרים',
  online: 'אונליין',
  frontal: 'פרונטלי',
};

export default function MeetingExpenses({ meetingId, isAdmin, canSubmit }: MeetingExpensesProps) {
  const { data: expenses, isLoading } = useMeetingExpenses(meetingId);
  const { data: meeting } = useMeeting(meetingId);
  const { data: instructors } = useInstructors();
  const createExpense = useCreateMeetingExpense();
  const deleteExpense = useDeleteMeetingExpense();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newExpense, setNewExpense] = useState({
    type: 'travel' as MeetingExpense['type'],
    description: '',
    amount: '',
    instructorId: '',
    rateType: 'preparation' as 'preparation' | 'online' | 'frontal',
  });

  // Calculate meeting duration from start/end times or cycle
  const getMeetingHours = () => {
    if (!meeting) return 1;
    if (meeting.startTime && meeting.endTime) {
      const start = new Date(meeting.startTime);
      const end = new Date(meeting.endTime);
      return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    }
    return (meeting.cycle?.durationMinutes || 60) / 60;
  };

  // Calculate preview for extra_instructor
  const [previewAmount, setPreviewAmount] = useState<number | null>(null);

  useEffect(() => {
    if (newExpense.type === 'extra_instructor' && newExpense.instructorId && meeting) {
      const instructor = instructors?.find(i => i.id === newExpense.instructorId);
      if (instructor) {
        const hours = getMeetingHours();
        let rate = 0;
        switch (newExpense.rateType) {
          case 'preparation':
            rate = Number(instructor.ratePreparation || 0);
            break;
          case 'online':
            rate = Number(instructor.rateOnline || 0);
            break;
          case 'frontal':
            rate = Number(instructor.rateFrontal || 0);
            break;
        }
        let amount = hours * rate;
        if (instructor.employmentType === 'employee') {
          amount = amount * 1.3;
        }
        setPreviewAmount(Math.round(amount));
      }
    } else {
      setPreviewAmount(null);
    }
  }, [newExpense.type, newExpense.instructorId, newExpense.rateType, meeting, instructors]);

  const handleAdd = async () => {
    if (newExpense.type === 'extra_instructor') {
      if (!newExpense.instructorId) return;
      try {
        await createExpense.mutateAsync({
          meetingId,
          type: newExpense.type,
          description: newExpense.description || undefined,
          instructorId: newExpense.instructorId,
          rateType: newExpense.rateType,
        });
        setNewExpense({ type: 'travel', description: '', amount: '', instructorId: '', rateType: 'preparation' });
        setShowAddForm(false);
      } catch (error) {
        console.error('Failed to add expense:', error);
      }
    } else {
      if (!newExpense.amount || Number(newExpense.amount) <= 0) return;
      try {
        await createExpense.mutateAsync({
          meetingId,
          type: newExpense.type,
          description: newExpense.description || undefined,
          amount: Number(newExpense.amount),
        });
        setNewExpense({ type: 'travel', description: '', amount: '', instructorId: '', rateType: 'preparation' });
        setShowAddForm(false);
      } catch (error) {
        console.error('Failed to add expense:', error);
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('האם למחוק הוצאה זו?')) return;
    try {
      await deleteExpense.mutateAsync({ id, meetingId });
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
  const totalExpenses = expensesList.reduce((sum: number, e: MeetingExpense) => 
    e.status !== 'rejected' ? sum + Number(e.amount) : sum, 0);

  // Filter out main instructor from the list
  const availableInstructors = instructors?.filter(i => i.id !== meeting?.instructorId) || [];

  return (
    <div className="space-y-4">
      {/* Summary */}
      {expensesList.length > 0 && (
        <div className="bg-gray-50 p-3 rounded-lg">
          <span className="text-gray-500">סה"כ הוצאות:</span>
          <span className="font-bold text-gray-900 mr-2">{formatCurrency(totalExpenses)}</span>
        </div>
      )}

      {/* Expenses List */}
      {expensesList.length > 0 ? (
        <div className="space-y-2">
          {expensesList.map((expense: MeetingExpense) => (
            <div
              key={expense.id}
              className="p-3 border rounded-lg"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400">{expenseTypeIcons[expense.type]}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{expenseTypeLabels[expense.type]}</span>
                      {expense.type === 'extra_instructor' && expense.instructor && (
                        <span className="text-sm text-blue-600">({expense.instructor.name})</span>
                      )}
                    </div>
                    {expense.description && (
                      <p className="text-sm text-gray-500">{expense.description}</p>
                    )}
                    {expense.type === 'extra_instructor' && expense.rateType && (
                      <p className="text-xs text-gray-400">
                        תעריף: {rateTypeLabels[expense.rateType]}
                        {expense.hours && ` • ${expense.hours} שעות`}
                        {expense.instructor?.employmentType === 'employee' && ' • כולל עלות מעסיק'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold">{formatCurrency(Number(expense.amount))}</span>
                  
                  {/* Delete button - admin can always delete */}
                  {isAdmin && (
                    <button
                      onClick={() => handleDelete(expense.id)}
                      className="text-gray-400 hover:text-red-600 p-1"
                      title="מחק"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-center text-gray-500 py-4">אין הוצאות נלוות</p>
      )}

      {/* Add Form */}
      {canSubmit && (
        <>
          {showAddForm ? (
            <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
              {/* Expense Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">סוג הוצאה</label>
                <select
                  value={newExpense.type}
                  onChange={(e) => setNewExpense({ 
                    ...newExpense, 
                    type: e.target.value as MeetingExpense['type'],
                    amount: '',
                    instructorId: '',
                  })}
                  className="input w-full"
                >
                  {Object.entries(expenseTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Extra Instructor Fields */}
              {newExpense.type === 'extra_instructor' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">מדריך נוסף</label>
                    <select
                      value={newExpense.instructorId}
                      onChange={(e) => setNewExpense({ ...newExpense, instructorId: e.target.value })}
                      className="input w-full"
                    >
                      <option value="">בחר מדריך</option>
                      {availableInstructors.map((instructor) => (
                        <option key={instructor.id} value={instructor.id}>
                          {instructor.name}
                          {instructor.employmentType === 'employee' ? ' (שכיר)' : ' (עצמאי)'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">סוג תעריף</label>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(rateTypeLabels).map(([value, label]) => (
                        <label key={value} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="rateType"
                            value={value}
                            checked={newExpense.rateType === value}
                            onChange={(e) => setNewExpense({ ...newExpense, rateType: e.target.value as 'preparation' | 'online' | 'frontal' })}
                            className="text-blue-600"
                          />
                          <span className="text-sm">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Preview calculation */}
                  {previewAmount !== null && (
                    <div className="p-3 bg-blue-50 rounded-lg text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-blue-700">עלות מחושבת:</span>
                        <span className="font-bold text-blue-800">{formatCurrency(previewAmount)}</span>
                      </div>
                      <p className="text-xs text-blue-600 mt-1">
                        {meeting ? `${getMeetingHours().toFixed(1)} שעות` : ''}
                        {' × תעריף '}
                        {rateTypeLabels[newExpense.rateType]}
                        {instructors?.find(i => i.id === newExpense.instructorId)?.employmentType === 'employee' && ' × 1.3 (עלות מעסיק)'}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                /* Regular expense fields */
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="תיאור (אופציונלי)"
                    value={newExpense.description}
                    onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                    className="input"
                  />
                  <input
                    type="number"
                    placeholder="סכום ₪"
                    value={newExpense.amount}
                    onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                    className="input"
                  />
                </div>
              )}

              {/* Description for extra_instructor */}
              {newExpense.type === 'extra_instructor' && (
                <input
                  type="text"
                  placeholder="הערה (אופציונלי)"
                  value={newExpense.description}
                  onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                  className="input w-full"
                />
              )}

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="btn btn-secondary btn-sm"
                >
                  ביטול
                </button>
                <button
                  onClick={handleAdd}
                  disabled={
                    createExpense.isPending ||
                    (newExpense.type === 'extra_instructor' ? !newExpense.instructorId : (!newExpense.amount || Number(newExpense.amount) <= 0))
                  }
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
              הוסף הוצאה
            </button>
          )}
        </>
      )}
    </div>
  );
}
