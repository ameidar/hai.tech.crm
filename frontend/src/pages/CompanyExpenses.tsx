import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  useCompanyExpenseSummary,
  useCompanyExpenses,
  useRecurringExpenses,
  useMissingRecurringExpenses,
  useSyncCompanyExpenses,
  useDetectRecurringExpenses,
  useSaveRecurringExpense,
  type CompanyExpense,
  type CompanyExpenseFilters,
  type RecurringExpense,
  type RecurringExpenseInput,
  type RecurringExpenseStatus,
} from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import Modal from '../components/ui/Modal';

type Tab = 'overview' | 'expenses' | 'pending' | 'recurring';

const errorMessage = (e: unknown, fallback: string) => {
  const data = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  return data?.error || data?.message || fallback;
};

const ils = (n: number | null | undefined) => `₪${Math.round(n ?? 0).toLocaleString('he-IL')}`;
const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
const fmtDate = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');
const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'טרם סונכרן';

// Observed Morning statuses — 10 awaiting approval, 20 approved.
const STATUS_LABEL: Record<number, { label: string; cls: string }> = {
  10: { label: 'ממתין לאישור', cls: 'bg-amber-100 text-amber-700' },
  20: { label: 'מאושר', cls: 'bg-emerald-100 text-emerald-700' },
};

const RECURRING_STATUS: Record<RecurringExpenseStatus, { label: string; cls: string }> = {
  suggested: { label: 'הצעה', cls: 'bg-blue-100 text-blue-700' },
  active: { label: 'פעיל', cls: 'bg-emerald-100 text-emerald-700' },
  ignored: { label: 'מתעלם', cls: 'bg-gray-100 text-gray-500' },
};

function StatusBadge({ status }: { status: number | null }) {
  const s = status !== null ? STATUS_LABEL[status] : undefined;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s?.cls ?? 'bg-gray-100 text-gray-600'}`}>
      {s?.label ?? `סטטוס ${status ?? '—'}`}
    </span>
  );
}

function KpiCard({ title, value, sub, tone, icon: Icon }: {
  title: string; value: string; sub?: string; tone: string; icon: typeof Wallet;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{title}</span>
        <div className={`p-2 rounded-lg ${tone}`}><Icon size={16} /></div>
      </div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function ExpensesTable({ rows }: { rows: CompanyExpense[] }) {
  if (!rows.length) return <div className="p-8 text-center text-gray-400">אין הוצאות להצגה</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="text-right px-4 py-3 font-medium">תאריך</th>
            <th className="text-right px-4 py-3 font-medium">חודש דיווח</th>
            <th className="text-right px-4 py-3 font-medium">ספק</th>
            <th className="text-right px-4 py-3 font-medium">סיווג</th>
            <th className="text-right px-4 py-3 font-medium">תיאור</th>
            <th className="text-right px-4 py-3 font-medium">מס׳ מסמך</th>
            <th className="text-right px-4 py-3 font-medium">ברוטו</th>
            <th className="text-right px-4 py-3 font-medium">נטו</th>
            <th className="text-right px-4 py-3 font-medium">סטטוס</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((e) => (
            <tr key={e.id} className="hover:bg-gray-50">
              <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(e.date)}</td>
              <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">{e.month ? monthLabel(e.month) : '—'}</td>
              <td className="px-4 py-2.5 font-medium text-gray-900">{e.supplierName ?? '—'}</td>
              <td className="px-4 py-2.5 text-gray-600">{e.categoryTitle ?? '—'}</td>
              <td className="px-4 py-2.5 text-gray-600 max-w-xs truncate" title={e.description ?? ''}>{e.description ?? ''}</td>
              <td className="px-4 py-2.5 text-gray-500">{e.number ?? '—'}</td>
              <td className="px-4 py-2.5 font-medium whitespace-nowrap">{ils(e.amount)}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{e.amountExcludeVat !== null ? ils(e.amountExcludeVat) : '—'}</td>
              <td className="px-4 py-2.5"><StatusBadge status={e.status} /></td>
              <td className="px-4 py-2.5">
                {e.url && (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800" title="פתח מסמך במורנינג">
                    <ExternalLink size={16} />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpensesTab({ suppliers, categories }: { suppliers: string[]; categories: string[] }) {
  const [filters, setFilters] = useState<CompanyExpenseFilters>({ page: 1, limit: 50 });
  const [searchInput, setSearchInput] = useState('');
  const { data, isLoading, isFetching } = useCompanyExpenses(filters);
  const set = (patch: Partial<CompanyExpenseFilters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div className="p-4 flex flex-wrap gap-3 items-end border-b border-gray-100">
        <form
          className="relative flex-1 min-w-[200px]"
          onSubmit={(e) => { e.preventDefault(); set({ search: searchInput.trim() || undefined }); }}
        >
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="חיפוש ספק / תיאור / מס׳ מסמך..." className="form-input pr-9 w-full" />
        </form>
        <label className="text-xs text-gray-500">מחודש
          <input type="month" className="form-input block" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
        </label>
        <label className="text-xs text-gray-500">עד חודש
          <input type="month" className="form-input block" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
        </label>
        <select className="form-input" value={filters.supplier ?? ''} onChange={(e) => set({ supplier: e.target.value || undefined })}>
          <option value="">כל הספקים</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="form-input" value={filters.category ?? ''} onChange={(e) => set({ category: e.target.value || undefined })}>
          <option value="">כל הסיווגים</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="form-input" value={filters.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}>
          <option value="">כל הסטטוסים</option>
          <option value="10">ממתין לאישור</option>
          <option value="20">מאושר</option>
        </select>
      </div>
      {isLoading ? <Loading /> : (
        <>
          <ExpensesTable rows={data?.data ?? []} />
          {data && (
            <div className="flex items-center justify-between p-4 border-t border-gray-100 text-sm text-gray-600">
              <span>
                {data.pagination.total} הוצאות · סה״כ ברוטו {ils(data.totals.gross)} · נטו {ils(data.totals.net)}
                {isFetching && ' · מעדכן...'}
              </span>
              <div className="flex items-center gap-2">
                <button className="btn btn-secondary" disabled={!data.pagination.hasPrev} onClick={() => set({ page: (filters.page ?? 1) - 1 })}>הקודם</button>
                <span>{data.pagination.page} / {data.pagination.totalPages}</span>
                <button className="btn btn-secondary" disabled={!data.pagination.hasNext} onClick={() => set({ page: (filters.page ?? 1) + 1 })}>הבא</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecurringForm({ initial, onSave, onCancel, saving }: {
  initial?: RecurringExpense | null;
  onSave: (data: RecurringExpenseInput) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    label: initial?.label ?? '',
    supplierName: initial?.supplierName ?? '',
    expectedDayOfMonth: String(initial?.expectedDayOfMonth ?? 1),
    expectedAmount: initial?.expectedAmount != null ? String(initial.expectedAmount) : '',
    tolerancePct: initial?.tolerancePct != null ? String(initial.tolerancePct) : '',
    categoryTitle: initial?.categoryTitle ?? '',
    notes: initial?.notes ?? '',
  });
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          label: form.label.trim() || form.supplierName.trim(),
          supplierName: form.supplierName.trim(),
          expectedDayOfMonth: Number(form.expectedDayOfMonth),
          expectedAmount: form.expectedAmount ? Number(form.expectedAmount) : null,
          tolerancePct: form.tolerancePct ? Number(form.tolerancePct) : null,
          categoryTitle: form.categoryTitle.trim() || null,
          notes: form.notes.trim() || null,
        });
      }}
    >
      <label className="block text-sm">שם ספק (כפי שמופיע במורנינג) *
        <input required className="form-input w-full mt-1" {...field('supplierName')} />
      </label>
      <label className="block text-sm">תווית
        <input className="form-input w-full mt-1" placeholder="ברירת מחדל: שם הספק" {...field('label')} />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="block text-sm">יום צפוי בחודש *
          <input required type="number" min={1} max={31} className="form-input w-full mt-1" {...field('expectedDayOfMonth')} />
        </label>
        <label className="block text-sm">סכום צפוי (₪ ברוטו)
          <input type="number" min={0} step="0.01" className="form-input w-full mt-1" {...field('expectedAmount')} />
        </label>
        <label className="block text-sm">סטייה מותרת (%)
          <input type="number" min={0} max={100} className="form-input w-full mt-1" placeholder="ריק = כל סכום" {...field('tolerancePct')} />
        </label>
      </div>
      <label className="block text-sm">סיווג
        <input className="form-input w-full mt-1" {...field('categoryTitle')} />
      </label>
      <label className="block text-sm">הערות
        <textarea rows={2} className="form-input w-full mt-1" {...field('notes')} />
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>ביטול</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'שומר...' : 'שמירה'}</button>
      </div>
    </form>
  );
}

function RecurringTab() {
  const { data: rows, isLoading } = useRecurringExpenses();
  const save = useSaveRecurringExpense();
  const detect = useDetectRecurringExpenses();
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [adding, setAdding] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);

  const setStatus = (r: RecurringExpense, status: RecurringExpenseStatus) =>
    save.mutate({ id: r.id, data: { status } }, { onError: () => alert('העדכון נכשל') });

  const handleSave = async (data: RecurringExpenseInput) => {
    try {
      await save.mutateAsync({ id: editing?.id, data });
      setEditing(null);
      setAdding(false);
    } catch (e) {
      alert(errorMessage(e, 'השמירה נכשלה'));
    }
  };

  const order: Record<RecurringExpenseStatus, number> = { suggested: 0, active: 1, ignored: 2 };
  const list = (rows ?? [])
    .filter((r) => showIgnored || r.status !== 'ignored')
    .sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label, 'he'));
  const suggestedCount = (rows ?? []).filter((r) => r.status === 'suggested').length;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div className="p-4 flex flex-wrap items-center gap-3 border-b border-gray-100">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">חשבוניות קבועות</h3>
          <p className="text-xs text-gray-500">
            ספקים שמופיעים ב-4 מתוך 6 החודשים האחרונים מוצעים אוטומטית — רק "פעיל" נבדק ונשלחת עליו תזכורת.
            {suggestedCount > 0 && ` ${suggestedCount} הצעות ממתינות להחלטה.`}
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} /> הצג מתעלמים
        </label>
        <button
          className="btn btn-secondary"
          disabled={detect.isPending}
          onClick={() => detect.mutate(undefined, {
            onSuccess: (r) => alert(r.created ? `נוספו ${r.created} הצעות חדשות` : 'לא נמצאו הצעות חדשות'),
            onError: () => alert('הזיהוי נכשל'),
          })}
        >
          <Sparkles size={16} /> {detect.isPending ? 'מזהה...' : 'זיהוי אוטומטי'}
        </button>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> הוספה ידנית</button>
      </div>
      {isLoading ? <Loading /> : list.length === 0 ? (
        <div className="p-8 text-center text-gray-400">אין חשבוניות קבועות עדיין</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-right px-4 py-3 font-medium">תווית</th>
                <th className="text-right px-4 py-3 font-medium">ספק</th>
                <th className="text-right px-4 py-3 font-medium">יום צפוי</th>
                <th className="text-right px-4 py-3 font-medium">סכום צפוי</th>
                <th className="text-right px-4 py-3 font-medium">סטייה</th>
                <th className="text-right px-4 py-3 font-medium">סיווג</th>
                <th className="text-right px-4 py-3 font-medium">מקור</th>
                <th className="text-right px-4 py-3 font-medium">סטטוס</th>
                <th className="text-right px-4 py-3 font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((r) => (
                <tr key={r.id} className={r.status === 'ignored' ? 'text-gray-400' : ''}>
                  <td className="px-4 py-2.5 font-medium" title={r.notes ?? ''}>{r.label}</td>
                  <td className="px-4 py-2.5">{r.supplierName}</td>
                  <td className="px-4 py-2.5">{r.expectedDayOfMonth}</td>
                  <td className="px-4 py-2.5">{r.expectedAmount !== null ? ils(r.expectedAmount) : '—'}</td>
                  <td className="px-4 py-2.5">{r.tolerancePct !== null ? `±${r.tolerancePct}%` : 'כל סכום'}</td>
                  <td className="px-4 py-2.5">{r.categoryTitle ?? '—'}</td>
                  <td className="px-4 py-2.5">{r.source === 'auto' ? 'אוטומטי' : 'ידני'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RECURRING_STATUS[r.status].cls}`}>{RECURRING_STATUS[r.status].label}</span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap space-x-2 space-x-reverse">
                    {r.status !== 'active' && (
                      <button className="text-emerald-600 hover:underline" onClick={() => setStatus(r, 'active')}>הפעל</button>
                    )}
                    {r.status !== 'ignored' && (
                      <button className="text-gray-500 hover:underline" onClick={() => setStatus(r, 'ignored')}>התעלם</button>
                    )}
                    <button className="text-blue-600 hover:underline" onClick={() => setEditing(r)}>עריכה</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal isOpen={adding || !!editing} onClose={() => { setAdding(false); setEditing(null); }} title={editing ? 'עריכת חשבונית קבועה' : 'הוספת חשבונית קבועה'}>
        <RecurringForm
          key={editing?.id ?? 'new'}
          initial={editing}
          saving={save.isPending}
          onSave={handleSave}
          onCancel={() => { setAdding(false); setEditing(null); }}
        />
      </Modal>
    </div>
  );
}

export default function CompanyExpenses() {
  const [tab, setTab] = useState<Tab>('overview');
  const { data: summary, isLoading, error } = useCompanyExpenseSummary();
  const { data: missing } = useMissingRecurringExpenses();
  const sync = useSyncCompanyExpenses();

  const handleSync = (full = false) =>
    sync.mutate(full, {
      onSuccess: (r) => alert(`סונכרנו ${r.fetched} הוצאות (${r.created} חדשות, ${r.updated} עודכנו)${r.newRecurringSuggestions ? ` · ${r.newRecurringSuggestions} הצעות חדשות לחשבוניות קבועות` : ''}`),
      onError: (e) => alert(errorMessage(e, 'הסנכרון נכשל')),
    });

  const k = summary?.kpis;
  const diff = k && k.lastMonth.gross ? ((k.thisMonth.gross - k.lastMonth.gross) / k.lastMonth.gross) * 100 : null;
  const chartData = (summary?.months ?? []).map((m) => ({ ...m, label: monthLabel(m.month) }));
  const categoryData = (summary?.byCategory ?? []).slice(0, 10);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'סקירה' },
    { key: 'expenses', label: 'כל ההוצאות' },
    { key: 'pending', label: `ממתין לאישור${k?.pendingCount ? ` (${k.pendingCount})` : ''}` },
    { key: 'recurring', label: 'חשבוניות קבועות' },
  ];

  return (
    <>
      <PageHeader
        title="הוצאות החברה"
        subtitle={`נתונים ממורנינג · סנכרון אחרון: ${fmtDateTime(summary?.lastSyncedAt ?? null)}`}
        actions={
          <button
            onClick={() => handleSync(!summary?.lastSyncedAt)}
            disabled={sync.isPending || summary?.syncRunning}
            className="btn btn-primary"
            title="משיכת הוצאות מעודכנות ממורנינג (60 הימים האחרונים; בסנכרון ראשון — 13 חודשים)"
          >
            <RefreshCw size={18} className={sync.isPending ? 'animate-spin' : ''} /> {sync.isPending ? 'מסנכרן...' : 'רענן עכשיו'}
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto space-y-6">
        {summary && !summary.morningConfigured && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">Morning לא מוגדר בשרת — לא ניתן לסנכרן הוצאות.</div>
        )}

        {/* Missing recurring invoices — prominent */}
        {missing && missing.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-amber-800 font-semibold mb-2">
              <AlertTriangle size={18} /> חסר החודש — {missing.length} חשבוניות קבועות שעדיין לא הגיעו
            </div>
            <ul className="grid gap-1 md:grid-cols-2 text-sm text-amber-900">
              {missing.map((m) => (
                <li key={`${m.id}-${m.month}`} className="flex items-center gap-2">
                  <CalendarClock size={14} className="flex-shrink-0" />
                  <span className="font-medium">{m.label}</span>
                  <span className="text-amber-700">· {monthLabel(m.month)} · צפוי ב-{m.expectedDayOfMonth} לחודש{m.expectedAmount ? ` · ~${ils(m.expectedAmount)}` : ''} · באיחור {m.daysOverdue} ימים</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isLoading ? <Loading /> : error || !summary ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-red-600">שגיאה בטעינת נתוני ההוצאות</div>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                title="החודש"
                value={ils(k!.thisMonth.gross)}
                sub={`נטו ${ils(k!.thisMonth.net)} · ${k!.thisMonth.count} מסמכים${diff !== null ? ` · ${diff >= 0 ? '+' : ''}${Math.round(diff)}% מהחודש הקודם` : ''}`}
                tone="bg-blue-50 text-blue-600"
                icon={Wallet}
              />
              <KpiCard title="חודש קודם" value={ils(k!.lastMonth.gross)} sub={`נטו ${ils(k!.lastMonth.net)} · ${k!.lastMonth.count} מסמכים`} tone="bg-slate-50 text-slate-600" icon={diff !== null && diff < 0 ? TrendingDown : TrendingUp} />
              <KpiCard title="ממוצע 3 חודשים" value={ils(k!.threeMonthAvg.gross)} sub={`נטו ${ils(k!.threeMonthAvg.net)} · 3 החודשים המלאים האחרונים`} tone="bg-violet-50 text-violet-600" icon={TrendingUp} />
              <KpiCard title="ממתין לאישור" value={String(k!.pendingCount)} sub={`סה״כ ${ils(k!.pendingGross)}`} tone="bg-amber-50 text-amber-600" icon={Clock} />
            </div>

            <div className="flex gap-1 border-b border-gray-200">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 lg:col-span-2">
                  <h3 className="font-semibold text-gray-900 mb-3">הוצאות לפי חודש (12 חודשים)</h3>
                  <div className="h-72" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₪${Math.round(v / 1000)}k`} />
                        <Tooltip formatter={(v) => ils(Number(v))} />
                        <Legend />
                        <Bar dataKey="gross" name="ברוטו" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="net" name="נטו" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">ספקים מובילים (12 חודשים)</h3>
                  {summary.topSuppliers.length === 0 ? <p className="text-sm text-gray-400">אין נתונים</p> : (
                    <ul className="space-y-2 text-sm">
                      {summary.topSuppliers.map((s, i) => (
                        <li key={`${s.supplierId ?? s.supplierName}-${i}`} className="flex items-center justify-between gap-2">
                          <span className="truncate"><span className="text-gray-400 ml-1">{i + 1}.</span>{s.supplierName}</span>
                          <span className="font-medium whitespace-nowrap">{ils(s.gross)} <span className="text-xs text-gray-400">({s.count})</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 lg:col-span-3">
                  <h3 className="font-semibold text-gray-900 mb-3">לפי סיווג (12 חודשים, ברוטו)</h3>
                  {categoryData.length === 0 ? <p className="text-sm text-gray-400">אין נתונים</p> : (
                    <div style={{ height: Math.max(160, categoryData.length * 34) }} dir="ltr">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={categoryData} layout="vertical" margin={{ left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `₪${Math.round(v / 1000)}k`} />
                          <YAxis type="category" dataKey="category" width={160} tick={{ fontSize: 12 }} orientation="right" />
                          <Tooltip formatter={(v) => ils(Number(v))} />
                          <Bar dataKey="gross" name="ברוטו" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'expenses' && <ExpensesTab suppliers={summary.filters.suppliers} categories={summary.filters.categories} />}

            {tab === 'pending' && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
                <div className="p-4 border-b border-gray-100 flex items-center gap-2 text-sm text-gray-600">
                  {summary.pending.length ? <Clock size={16} className="text-amber-500" /> : <CheckCircle2 size={16} className="text-emerald-500" />}
                  {summary.pending.length ? `${summary.pending.length} הוצאות ממתינות לאישור במורנינג (${ils(k!.pendingGross)})` : 'אין הוצאות שממתינות לאישור'}
                </div>
                <ExpensesTable rows={summary.pending} />
              </div>
            )}

            {tab === 'recurring' && <RecurringTab />}
          </>
        )}
      </div>
    </>
  );
}
