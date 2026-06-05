import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Clock, CheckCircle, XCircle, Hourglass } from 'lucide-react';
import api from '../api/client';

interface WorkHourEntry {
  id: string;
  workDate: string;
  hours: number | string;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
}

interface MineResponse {
  instructor: { id: string; name: string; hourlyRate: number };
  entries: WorkHourEntry[];
  summary: {
    totalHours: number;
    approvedHours: number;
    pendingHours: number;
    approvedPayment: number;
  };
}

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const StatusBadge = ({ status }: { status: WorkHourEntry['status'] }) => {
  const map = {
    pending: { label: 'ממתין לאישור', cls: 'bg-amber-100 text-amber-800', Icon: Hourglass },
    approved: { label: 'מאושר', cls: 'bg-green-100 text-green-800', Icon: CheckCircle },
    rejected: { label: 'נדחה', cls: 'bg-red-100 text-red-800', Icon: XCircle },
  }[status];
  const { Icon } = map;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${map.cls}`}>
      <Icon size={12} /> {map.label}
    </span>
  );
};

export default function OperationsHours() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [workDate, setWorkDate] = useState(new Date().toISOString().split('T')[0]);
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<MineResponse>({
    queryKey: ['work-hours-mine', month],
    queryFn: async () => (await api.get(`/work-hours/mine?month=${month}`)).data,
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/work-hours', {
      workDate,
      hours: Number(hours),
      description: description || undefined,
    }),
    onSuccess: () => {
      setHours('');
      setDescription('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['work-hours-mine'] });
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'שגיאה בשמירת הדיווח');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/work-hours/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-hours-mine'] }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workDate || !hours || Number(hours) <= 0) {
      setError('יש להזין תאריך ומספר שעות תקין');
      return;
    }
    createMutation.mutate();
  };

  const [year, m] = month.split('-').map(Number);
  const monthLabel = `${HEBREW_MONTHS[m - 1]} ${year}`;
  const summary = data?.summary;
  const rate = data?.instructor?.hourlyRate ?? 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Clock className="text-blue-600" /> דיווח שעות
        </h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-xs text-gray-500">שעות מאושרות</p>
          <p className="text-2xl font-bold text-green-600">{summary?.approvedHours ?? 0}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-xs text-gray-500">ממתינות לאישור</p>
          <p className="text-2xl font-bold text-amber-600">{summary?.pendingHours ?? 0}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <p className="text-xs text-gray-500">לתשלום (מאושר × ₪{rate})</p>
          <p className="text-2xl font-bold text-gray-900">₪{summary?.approvedPayment ?? 0}</p>
        </div>
      </div>

      {/* Report form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 space-y-4">
        <h2 className="font-semibold text-gray-700">דיווח חדש</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">תאריך</label>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">מספר שעות</label>
            <input type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full" placeholder="לדוגמה: 2.5" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">תיאור (אופציונלי)</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full" placeholder="מה נעשה" />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={createMutation.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {createMutation.isPending ? 'שומר...' : 'הוסף דיווח'}
          </button>
        </div>
      </form>

      {/* Entries list */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-gray-700">דיווחים — {monthLabel}</div>
        {isLoading ? (
          <div className="p-6 text-center text-gray-400">טוען...</div>
        ) : !data?.entries.length ? (
          <div className="p-6 text-center text-gray-400">אין דיווחים לחודש זה</div>
        ) : (
          <ul className="divide-y">
            {data.entries.map((e) => (
              <li key={e.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-gray-900">
                      {new Date(e.workDate).toLocaleDateString('he-IL')}
                    </span>
                    <span className="text-gray-600">{Number(e.hours)} שעות</span>
                    <StatusBadge status={e.status} />
                  </div>
                  {e.description && <p className="text-sm text-gray-500 truncate">{e.description}</p>}
                  {e.status === 'rejected' && e.rejectionReason && (
                    <p className="text-xs text-red-500">סיבת דחייה: {e.rejectionReason}</p>
                  )}
                </div>
                {e.status === 'pending' && (
                  <button
                    onClick={() => { if (window.confirm('למחוק את הדיווח?')) deleteMutation.mutate(e.id); }}
                    className="text-gray-400 hover:text-red-600 p-1"
                    title="מחק"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
