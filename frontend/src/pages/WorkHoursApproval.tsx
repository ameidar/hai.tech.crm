import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, Hourglass } from 'lucide-react';
import api from '../api/client';
import PageHeader from '../components/ui/PageHeader';

interface WorkHourEntry {
  id: string;
  workDate: string;
  hours: number | string;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  instructor: { id: string; name: string; hourlyRate: number | string | null };
}

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const StatusBadge = ({ status }: { status: WorkHourEntry['status'] }) => {
  const map = {
    pending: { label: 'ממתין', cls: 'bg-amber-100 text-amber-800', Icon: Hourglass },
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

export default function WorkHoursApproval() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth());

  const { data: entries = [], isLoading } = useQuery<WorkHourEntry[]>({
    queryKey: ['work-hours-admin', month],
    queryFn: async () => (await api.get(`/work-hours?month=${month}`)).data,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, action, rejectionReason }: { id: string; action: 'approve' | 'reject'; rejectionReason?: string }) =>
      api.post(`/work-hours/${id}/review`, { action, rejectionReason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-hours-admin'] }),
  });

  const approveMonthMutation = useMutation({
    mutationFn: (instructorId?: string) => api.post('/work-hours/approve-month', { month, instructorId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-hours-admin'] }),
  });

  const handleReject = (id: string) => {
    const reason = window.prompt('סיבת דחייה (אופציונלי):') ?? undefined;
    reviewMutation.mutate({ id, action: 'reject', rejectionReason: reason || undefined });
  };

  // Group by staff member
  const groups = new Map<string, { name: string; rate: number; entries: WorkHourEntry[] }>();
  for (const e of entries) {
    const g = groups.get(e.instructor.id) ?? { name: e.instructor.name, rate: Number(e.instructor.hourlyRate ?? 0), entries: [] };
    g.entries.push(e);
    groups.set(e.instructor.id, g);
  }

  const [year, m] = month.split('-').map(Number);
  const monthLabel = `${HEBREW_MONTHS[m - 1]} ${year}`;

  return (
    <div className="space-y-6">
      <PageHeader title="אישור שעות תפעול" />

      <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between flex-wrap gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
        <span className="text-sm text-gray-500">{monthLabel}</span>
      </div>

      {isLoading ? (
        <div className="p-6 text-center text-gray-400">טוען...</div>
      ) : groups.size === 0 ? (
        <div className="bg-white rounded-lg shadow p-6 text-center text-gray-400">אין דיווחי שעות לחודש זה</div>
      ) : (
        Array.from(groups.entries()).map(([staffId, g]) => {
          const approvedHours = g.entries.filter((e) => e.status === 'approved').reduce((s, e) => s + Number(e.hours), 0);
          const pendingHours = g.entries.filter((e) => e.status === 'pending').reduce((s, e) => s + Number(e.hours), 0);
          const hasPending = pendingHours > 0;
          return (
            <div key={staffId} className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="font-semibold text-gray-900">{g.name}</span>
                  <span className="text-sm text-gray-500 mr-3">
                    תעריף ₪{g.rate} · מאושר {approvedHours} ש' (₪{Math.round(approvedHours * g.rate)})
                    {pendingHours > 0 && ` · ממתין ${pendingHours} ש'`}
                  </span>
                </div>
                {hasPending && (
                  <button
                    onClick={() => { if (window.confirm(`לאשר את כל השעות הממתינות של ${g.name} לחודש ${monthLabel}?`)) approveMonthMutation.mutate(staffId); }}
                    className="bg-green-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-green-700"
                  >
                    אשר את כל הממתינים
                  </button>
                )}
              </div>
              <ul className="divide-y">
                {g.entries.map((e) => (
                  <li key={e.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-gray-900">{new Date(e.workDate).toLocaleDateString('he-IL')}</span>
                        <span className="text-gray-600">{Number(e.hours)} שעות</span>
                        <StatusBadge status={e.status} />
                      </div>
                      {e.description && <p className="text-sm text-gray-500 truncate">{e.description}</p>}
                    </div>
                    {e.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => reviewMutation.mutate({ id: e.id, action: 'approve' })}
                          className="text-green-600 hover:bg-green-50 p-1.5 rounded" title="אשר"
                        >
                          <CheckCircle size={18} />
                        </button>
                        <button
                          onClick={() => handleReject(e.id)}
                          className="text-red-600 hover:bg-red-50 p-1.5 rounded" title="דחה"
                        >
                          <XCircle size={18} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
