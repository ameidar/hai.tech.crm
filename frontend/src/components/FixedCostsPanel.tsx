import { useMemo, useState } from 'react';
import { Briefcase, Pencil, Plus, Trash2, X, Check } from 'lucide-react';
import {
  useForecast,
  useCompanyFixedCosts,
  useSaveCompanyFixedCost,
  useDeleteCompanyFixedCost,
  type CompanyFixedCost,
} from '../hooks/useApi';

// Monthly breakdown of fixed costs (salaried staff + instructor fixed additions such as
// coordination), plus management of the company-level fixed costs.
const ils = (n: number) => `₪${Math.round(n).toLocaleString()}`;

type Draft = { name: string; amount: string; startMonth: string; endMonth: string };
const emptyDraft = (): Draft => ({
  name: '',
  amount: '',
  startMonth: new Date().toISOString().slice(0, 7),
  endMonth: '',
});

export default function FixedCostsPanel() {
  const { data: forecast } = useForecast(6, 3);
  const { data: costs = [] } = useCompanyFixedCosts();
  const save = useSaveCompanyFixedCost();
  const remove = useDeleteCompanyFixedCost();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);

  const months = useMemo(
    () => (forecast ? [...forecast.historical, ...forecast.forecast] : []),
    [forecast],
  );

  const rows = useMemo(() => {
    const labels: string[] = [];
    for (const m of months) {
      for (const item of m.fixedCostItems ?? []) {
        if (!labels.includes(item.label)) labels.push(item.label);
      }
    }
    return labels.map((label) => ({
      label,
      values: months.map(
        (m) => (m.fixedCostItems ?? []).filter((i) => i.label === label).reduce((s, i) => s + i.amount, 0),
      ),
    }));
  }, [months]);

  const totals = months.map((m) =>
    (m.fixedCostItems ?? []).reduce((s, i) => s + i.amount, 0),
  );

  const startEdit = (cost?: CompanyFixedCost) => {
    setError(null);
    if (cost) {
      setEditingId(cost.id);
      setDraft({
        name: cost.name,
        amount: String(cost.amount),
        startMonth: cost.startMonth,
        endMonth: cost.endMonth ?? '',
      });
    } else {
      setEditingId('new');
      setDraft(emptyDraft());
    }
  };

  const submit = async () => {
    const amount = Number(draft.amount);
    if (!draft.name.trim() || !(amount > 0) || !draft.startMonth) {
      setError('יש למלא שם, סכום חיובי וחודש התחלה');
      return;
    }
    try {
      await save.mutateAsync({
        id: editingId && editingId !== 'new' ? editingId : undefined,
        data: {
          name: draft.name.trim(),
          amount,
          startMonth: draft.startMonth,
          endMonth: draft.endMonth || null,
        },
      });
      setEditingId(null);
    } catch (e) {
      const message = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message || 'שגיאה בשמירה');
    }
  };

  const onDelete = async (cost: CompanyFixedCost) => {
    if (!window.confirm(`למחוק את ההוצאה הקבועה "${cost.name}"?`)) return;
    await remove.mutateAsync(cost.id);
  };

  const inputCls = 'border border-gray-200 rounded-md px-2 py-1 text-sm';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-50 rounded-lg">
            <Briefcase className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">הוצאות קבועות לפי חודש</h2>
            <p className="text-sm text-gray-500">
              משכורות קבועות ותוספות קבועות למדריכים (למשל ריכוז). נכללות בתחזית ומורדות מהרווח.
            </p>
          </div>
        </div>
      </div>

      {months.length > 0 && (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-right py-2 px-3 font-semibold text-gray-700">הוצאה</th>
                {months.map((m) => (
                  <th
                    key={m.month}
                    className={`text-center py-2 px-3 font-semibold whitespace-nowrap ${m.isHistorical ? 'text-gray-700' : 'text-indigo-600'}`}
                  >
                    {m.monthName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-gray-50">
                  <td className="py-2 px-3 text-gray-900 whitespace-nowrap">{row.label}</td>
                  {row.values.map((v, i) => (
                    <td key={i} className="py-2 px-3 text-center text-gray-700">{v ? ils(v) : '—'}</td>
                  ))}
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2 px-3 text-gray-900">סה״כ</td>
                {totals.map((t, i) => (
                  <td key={i} className="py-2 px-3 text-center text-rose-600">{ils(t)}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-gray-400 mt-2">חודשים בכחול הם תחזית.</p>
        </div>
      )}

      <div className="border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 text-sm">ניהול משכורות קבועות</h3>
          {editingId === null && (
            <button
              onClick={() => startEdit()}
              className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
            >
              <Plus className="w-4 h-4" /> הוספה
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-3">
          הסכום הוא העלות החודשית המלאה לחברה (עלות מעסיק). תוספות קבועות למדריכים, כמו ריכוז, מנוהלות בכרטיס המדריך.
        </p>

        <div className="space-y-2">
          {costs.map((cost) =>
            editingId === cost.id ? null : (
              <div key={cost.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-gray-900">{cost.name}</span>
                  <span className="text-gray-500 mr-2">
                    {ils(cost.amount)} לחודש • מ-{cost.startMonth}
                    {cost.endMonth ? ` עד ${cost.endMonth}` : ''}
                  </span>
                </div>
                {editingId === null && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEdit(cost)} className="text-gray-400 hover:text-indigo-600" title="עריכה">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(cost)} className="text-gray-400 hover:text-rose-600" title="מחיקה">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ),
          )}

          {editingId !== null && (
            <div className="flex flex-wrap items-end gap-2 bg-indigo-50 rounded-lg px-3 py-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-600">שם</span>
                <input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-600">סכום חודשי (₪)</span>
                <input type="number" min={0} className={`${inputCls} w-28`} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-600">מחודש</span>
                <input type="month" className={inputCls} value={draft.startMonth} onChange={(e) => setDraft({ ...draft, startMonth: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-600">עד חודש (ריק = ללא סיום)</span>
                <input type="month" className={inputCls} value={draft.endMonth} onChange={(e) => setDraft({ ...draft, endMonth: e.target.value })} />
              </label>
              <button onClick={submit} disabled={save.isPending} className="flex items-center gap-1 bg-indigo-600 text-white rounded-md px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
                <Check className="w-4 h-4" /> שמירה
              </button>
              <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-gray-600 px-2 py-1.5 hover:text-gray-900">
                <X className="w-4 h-4" /> ביטול
              </button>
              {error && <div className="w-full text-xs text-rose-600">{error}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
