import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  ComposedChart,
  Line,
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
  ChevronDown,
  ChevronLeft,
  Clock,
  Link2,
  ExternalLink,
  FileUp,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  useCompanyExpenseSummary,
  useCompanyExpenses,
  useRecurringExpenses,
  useMissingRecurringExpenses,
  useSyncCompanyExpenses,
  useDetectRecurringExpenses,
  useSaveRecurringExpense,
  useSupplierGrid,
  useUploadExpenseInvoices,
  useFreelancerReconciliation,
  useFreelancerSuggestions,
  useFreelancerLinks,
  useCreateFreelancerLink,
  useDeleteFreelancerLink,
  useSetExpenseActivityMonth,
  type FreelancerLinkSuggestion,
  type FreelancerReconciliationRow,
  type FreelancerReconciliationStatus,
  type CompanyExpense,
  type CompanyExpenseFilters,
  type RecurringExpense,
  type RecurringExpenseInput,
  type RecurringExpenseStatus,
  type ExpenseUploadResult,
  type SupplierCadence,
  type SupplierGrid,
  type SupplierGridCellState,
  type SupplierInvoiceSource,
} from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import Modal from '../components/ui/Modal';

type Tab = 'overview' | 'expenses' | 'pending' | 'recurring' | 'freelancers';

const errorMessage = (e: unknown, fallback: string) => {
  const data = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  return data?.error || data?.message || fallback;
};

const ils = (n: number | null | undefined) => `₪${Math.round(n ?? 0).toLocaleString('he-IL')}`;
const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
/** "ספק (שם הפרילנסר)" — the linked instructor's name in parentheses, when there is one. */
const withFreelancer = (name: string, freelancerName?: string | null) => {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
  return freelancerName && !norm(name).includes(norm(freelancerName)) ? `${name} (${freelancerName})` : name;
};
const fmtDate = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');
const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'טרם סונכרן';

// Morning expense statuses (as labelled in Morning's UI): 10 = אושרה לדוח (approved, not yet reported), 20 = דווחה (reported).
const STATUS_LABEL: Record<number, { label: string; cls: string }> = {
  10: { label: 'אושרה לדוח', cls: 'bg-violet-100 text-violet-700' },
  20: { label: 'דווחה', cls: 'bg-emerald-100 text-emerald-700' },
};

const RECURRING_STATUS: Record<RecurringExpenseStatus, { label: string; cls: string }> = {
  suggested: { label: 'הצעה', cls: 'bg-blue-100 text-blue-700' },
  active: { label: 'פעיל', cls: 'bg-emerald-100 text-emerald-700' },
  ignored: { label: 'מתעלם', cls: 'bg-gray-100 text-gray-500' },
};

const DRAFT_BADGE = { label: 'טיוטה – ממתין לאישור', cls: 'bg-sky-100 text-sky-700' };

function StatusBadge({ status, isDraft }: { status: number | null; isDraft?: boolean }) {
  const s = isDraft ? DRAFT_BADGE : status !== null ? STATUS_LABEL[status] : undefined;
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
              <td className="px-4 py-2.5 font-medium text-gray-900" dir="auto">{e.supplierName ? withFreelancer(e.supplierName, e.freelancerName) : '—'}</td>
              <td className="px-4 py-2.5 text-gray-600">{e.categoryTitle ?? '—'}</td>
              <td className="px-4 py-2.5 text-gray-600 max-w-xs truncate" title={e.description ?? ''}>{e.description ?? ''}</td>
              <td className="px-4 py-2.5 text-gray-500">{e.number ?? '—'}</td>
              <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                {e.isDraft && e.originalAmount !== null && !e.amount ? '—' : ils(e.amount)}
                {e.originalAmount !== null && e.currency && (
                  <div className="text-xs font-normal text-gray-400" dir="ltr">
                    {e.originalAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })} {e.currency}{e.isDraft ? ' (שער משוער)' : ''}
                  </div>
                )}
              </td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{e.amountExcludeVat !== null ? ils(e.amountExcludeVat) : '—'}</td>
              <td className="px-4 py-2.5"><StatusBadge status={e.status} isDraft={e.isDraft} /></td>
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
        <select
          className="form-input"
          value={filters.kind ?? ''}
          onChange={(e) => set({ kind: (e.target.value || undefined) as CompanyExpenseFilters['kind'] })}
          title="סוג"
        >
          <option value="">סוג: הכל</option>
          <option value="freelancer">פרילנסרים</option>
          <option value="other">שאר ההוצאות</option>
        </select>
        <select className="form-input" value={filters.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}>
          <option value="">כל הסטטוסים</option>
          <option value="10">אושרה לדוח</option>
          <option value="20">דווחה</option>
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

const CADENCE_LABEL: Record<SupplierCadence, string> = { monthly: 'חודשי', yearly: 'שנתי', usage: 'לפי שימוש' };
const SOURCE_LABEL: Record<SupplierInvoiceSource, string> = { portal: 'פורטל', email: 'מייל', freelancer: 'פרילנסר', other: 'אחר' };
const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

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
    cadence: (initial?.cadence ?? 'monthly') as SupplierCadence,
    expectedMonth: initial?.expectedMonth != null ? String(initial.expectedMonth) : '',
    invoiceSource: (initial?.invoiceSource ?? 'portal') as SupplierInvoiceSource,
    portalUrl: initial?.portalUrl ?? '',
    instructions: initial?.instructions ?? '',
    owner: initial?.owner ?? '',
    aliases: (initial?.aliases ?? []).join(', '),
  });
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
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
          cadence: form.cadence,
          expectedMonth: form.cadence === 'yearly' && form.expectedMonth ? Number(form.expectedMonth) : null,
          invoiceSource: form.invoiceSource,
          portalUrl: form.portalUrl.trim() || null,
          instructions: form.instructions.trim() || null,
          owner: form.owner.trim() || null,
          aliases: form.aliases.split(',').map((a) => a.trim()).filter(Boolean),
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">שם ספק (כפי שמופיע במורנינג) *
          <input required className="form-input w-full mt-1" {...field('supplierName')} />
        </label>
        <label className="block text-sm">תווית
          <input className="form-input w-full mt-1" placeholder="ברירת מחדל: שם הספק" {...field('label')} />
        </label>
      </div>
      <label className="block text-sm">שמות נוספים במורנינג (כינויים, מופרדים בפסיק)
        <input className="form-input w-full mt-1" dir="auto" placeholder='למשל: "twillio, Twilio Inc' {...field('aliases')} />
        <span className="text-xs text-gray-400">טיוטות שמורנינג זיהה בשם אחר ייספרו לספק הזה רק אם השם מופיע כאן</span>
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="block text-sm">תדירות
          <select className="form-input w-full mt-1" {...field('cadence')}>
            {(Object.keys(CADENCE_LABEL) as SupplierCadence[]).map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
          </select>
        </label>
        {form.cadence === 'yearly' && (
          <label className="block text-sm">חודש צפוי *
            <select required className="form-input w-full mt-1" {...field('expectedMonth')}>
              <option value="">בחר חודש</option>
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
        )}
        <label className="block text-sm">יום צפוי בחודש *
          <input required type="number" min={1} max={31} className="form-input w-full mt-1" {...field('expectedDayOfMonth')} />
        </label>
      </div>
      {form.cadence === 'usage' && <p className="text-xs text-gray-500">"לפי שימוש" — מוצג בטבלה אך לעולם לא נחשב חסר ולא נשלחת עליו תזכורת.</p>}
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">סכום צפוי (₪ ברוטו)
          <input type="number" min={0} step="0.01" className="form-input w-full mt-1" {...field('expectedAmount')} />
        </label>
        <label className="block text-sm">סטייה מותרת (%)
          <input type="number" min={0} max={100} className="form-input w-full mt-1" placeholder="ריק = כל סכום" {...field('tolerancePct')} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">מקור החשבונית
          <select className="form-input w-full mt-1" {...field('invoiceSource')}>
            {(Object.keys(SOURCE_LABEL) as SupplierInvoiceSource[]).map((k) => <option key={k} value={k}>{SOURCE_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="block text-sm">אחראי
          <input className="form-input w-full mt-1" placeholder="למשל: עמי / אינה" {...field('owner')} />
        </label>
      </div>
      <label className="block text-sm">קישור להורדת חשבוניות
        <input type="url" dir="ltr" className="form-input w-full mt-1" placeholder="https://..." {...field('portalUrl')} />
      </label>
      <label className="block text-sm">הוראות הורדה
        <textarea rows={2} className="form-input w-full mt-1" {...field('instructions')} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">סיווג
          <input className="form-input w-full mt-1" {...field('categoryTitle')} />
        </label>
        <label className="block text-sm">הערות
          <input className="form-input w-full mt-1" {...field('notes')} />
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>ביטול</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'שומר...' : 'שמירה'}</button>
      </div>
    </form>
  );
}

const CELL_STYLE: Record<SupplierGridCellState, { cls: string; icon: string; label: string }> = {
  approved: { cls: 'bg-emerald-100 text-emerald-800', icon: '✅', label: 'התקבל ודווח' },
  pending: { cls: 'bg-violet-100 text-violet-800', icon: '✔️', label: 'התקבל – אושר לדוח' },
  draft: { cls: 'bg-sky-100 text-sky-800', icon: '🟦', label: 'טיוטה במורנינג' },
  missing: { cls: 'bg-red-100 text-red-700', icon: '❌', label: 'חסר' },
  not_due: { cls: 'bg-gray-100 text-gray-500', icon: '…', label: 'עוד לא הגיע מועד' },
  not_expected: { cls: 'bg-gray-50 text-gray-300', icon: '–', label: 'לא צפוי בחודש זה' },
};

function SupplierGridTable({ grid, onEdit }: { grid: SupplierGrid; onEdit: (r: RecurringExpense) => void }) {
  if (!grid.suppliers.length) return <div className="p-8 text-center text-gray-400">אין ספקים פעילים — הפעילו הצעות או הוסיפו ספק ידנית</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="text-right px-4 py-3 font-medium">ספק</th>
            <th className="text-right px-3 py-3 font-medium">מקור</th>
            {grid.months.map((m) => <th key={m} className="px-2 py-3 font-medium text-center whitespace-nowrap">{monthLabel(m)}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {grid.suppliers.map((s) => (
            <tr key={s.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 whitespace-nowrap">
                <div className="flex items-center gap-1.5">
                  <button className="font-medium text-gray-900 hover:text-blue-600" onClick={() => onEdit(s)} title={s.instructions ?? 'עריכה'}>{withFreelancer(s.label, s.freelancerName)}</button>
                  {s.portalUrl && (
                    <a href={s.portalUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800" title="פורטל החשבוניות">
                      <ExternalLink size={14} />
                    </a>
                  )}
                  {s.status === 'suggested' && <span className={`px-1.5 rounded text-[10px] ${RECURRING_STATUS.suggested.cls}`}>הצעה</span>}
                </div>
                <div className="text-xs text-gray-400">
                  {CADENCE_LABEL[s.cadence] ?? s.cadence}{s.cadence === 'yearly' && s.expectedMonth ? ` · ${MONTH_NAMES[s.expectedMonth - 1]}` : ''}
                  {s.owner ? ` · ${s.owner}` : ''}
                </div>
              </td>
              <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{SOURCE_LABEL[s.invoiceSource] ?? s.invoiceSource}</td>
              {grid.months.map((m) => {
                const c = s.cells[m];
                const st = CELL_STYLE[c?.state ?? 'not_expected'];
                const title = `${st.label}${c?.count ? ` · ${c.count} מסמכים · ${ils(c.gross)}` : ''}`;
                return (
                  <td key={m} className="px-1 py-1 text-center">
                    <div className={`rounded-md py-1.5 text-xs font-medium ${st.cls}`} title={title}>
                      {st.icon}{c?.count ? <span className="block text-[10px] font-normal">{ils(c.gross)}</span> : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-3 p-3 text-xs text-gray-500 border-t border-gray-100">
        {(Object.keys(CELL_STYLE) as SupplierGridCellState[]).map((k) => (
          <span key={k} className="flex items-center gap-1"><span className={`px-1.5 rounded ${CELL_STYLE[k].cls}`}>{CELL_STYLE[k].icon}</span>{CELL_STYLE[k].label}</span>
        ))}
      </div>
    </div>
  );
}

const UPLOAD_STATUS: Record<ExpenseUploadResult['status'], { label: string; cls: string }> = {
  uploaded: { label: 'הועלה', cls: 'text-emerald-700' },
  duplicate: { label: 'כפול — כבר הועלה', cls: 'text-gray-500' },
  failed: { label: 'נכשל', cls: 'text-red-600' },
};
const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
const MAX_FILES = 20;
const MAX_BYTES = 10 * 1024 * 1024;

function UploadPanel({ suppliers }: { suppliers: RecurringExpense[] }) {
  const upload = useUploadExpenseInvoices();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<ExpenseUploadResult[] | null>(null);
  const [refreshAt, setRefreshAt] = useState<number | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  const refresh = () => {
    setRefreshAt(null);
    void queryClient.invalidateQueries({ queryKey: ['companyExpenses'] });
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const ok = Array.from(list).filter((f) => /\.(pdf|jpe?g|png)$/i.test(f.name) && f.size <= MAX_BYTES);
    const rejected = list.length - ok.length;
    if (rejected) alert(`${rejected} קבצים לא נוספו (PDF / JPG / PNG בלבד, עד 10MB)`);
    setFiles((prev) => [...prev, ...ok].slice(0, MAX_FILES));
    setResults(null);
  };

  const submit = () => {
    if (!files.length) return;
    upload.mutate({ files, recurringExpenseId: supplierId || undefined }, {
      onSuccess: (r) => {
        setResults(r.results);
        setFiles([]);
        if (r.syncScheduled) {
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          setRefreshAt(Date.now() + 60_000);
          refreshTimer.current = setTimeout(refresh, 60_000);
        }
      },
      onError: (e) => alert(errorMessage(e, 'ההעלאה נכשלה')),
    });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Upload size={18} className="text-blue-600" />
        <h3 className="font-semibold text-gray-900">העלאת חשבוניות ל-Morning</h3>
        <span className="text-xs text-gray-500">הקבצים נכנסים כטיוטות במורנינג (זיהוי אוטומטי תוך כחצי דקה) וממתינים לאישור</span>
      </div>
      <div
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
      >
        <FileUp size={28} className="mx-auto text-gray-400" />
        <p className="text-sm text-gray-600 mt-2">גררו לכאן קבצים או לחצו לבחירה</p>
        <p className="text-xs text-gray-400">PDF / JPG / PNG · עד {MAX_FILES} קבצים · עד 10MB לקובץ</p>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {files.length > 0 && (
        <ul className="text-sm space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 bg-gray-50 rounded px-3 py-1.5">
              <span className="truncate" dir="auto">{f.name}</span>
              <span className="flex items-center gap-2 text-xs text-gray-400 whitespace-nowrap">
                {Math.round(f.size / 1024)}KB
                <button className="text-gray-400 hover:text-red-600" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} title="הסר"><X size={14} /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <select className="form-input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">שיוך לספק (לא חובה)</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button className="btn btn-primary" disabled={!files.length || upload.isPending} onClick={submit}>
          <Upload size={16} /> {upload.isPending ? 'מעלה...' : `העלאה${files.length ? ` (${files.length})` : ''}`}
        </button>
      </div>
      {results && (
        <div className="border-t border-gray-100 pt-3 space-y-1">
          <ul className="text-sm space-y-1">
            {results.map((r, i) => (
              <li key={`${r.fileName}-${i}`} className="flex items-center gap-2">
                <span className={`font-medium ${UPLOAD_STATUS[r.status].cls}`}>{UPLOAD_STATUS[r.status].label}</span>
                <span className="truncate text-gray-700" dir="auto">{r.fileName}</span>
                {r.error && <span className="text-xs text-red-500 truncate" title={r.error}>{r.error}</span>}
              </li>
            ))}
          </ul>
          {refreshAt && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              הטבלה תתעדכן אוטומטית בעוד כדקה, אחרי שמורנינג יסיים לזהות את הקבצים.
              <button className="text-blue-600 hover:underline" onClick={refresh}>רענן עכשיו</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SuppliersTab() {
  const [months, setMonths] = useState(6);
  const [showSuggestedInGrid, setShowSuggestedInGrid] = useState(false);
  const { data: grid, isLoading: gridLoading, isFetching: gridFetching } = useSupplierGrid(months, showSuggestedInGrid);
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
  const activeSuppliers = (rows ?? []).filter((r) => r.status === 'active').sort((a, b) => a.label.localeCompare(b.label, 'he'));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-gray-100">
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">מעקב חשבוניות לפי חודש</h3>
            <p className="text-xs text-gray-500">טיוטה במורנינג נחשבת כ"התקבל". עמודת החודש הנוכחי נצבעת באדום רק אחרי היום הצפוי + 5 ימי חסד.</p>
          </div>
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            <input type="checkbox" checked={showSuggestedInGrid} onChange={(e) => setShowSuggestedInGrid(e.target.checked)} /> כולל הצעות
          </label>
          <select className="form-input" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {[3, 6, 9, 12].map((n) => <option key={n} value={n}>{n} חודשים</option>)}
          </select>
          {gridFetching && !gridLoading && <RefreshCw size={14} className="animate-spin text-gray-400" />}
        </div>
        {gridLoading || !grid ? <Loading /> : <SupplierGridTable grid={grid} onEdit={setEditing} />}
      </div>

      <UploadPanel suppliers={activeSuppliers} />

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-gray-100">
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">ספקים</h3>
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
          <div className="p-8 text-center text-gray-400">אין ספקים עדיין</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-right px-4 py-3 font-medium">תווית</th>
                  <th className="text-right px-4 py-3 font-medium">ספק</th>
                  <th className="text-right px-4 py-3 font-medium">תדירות</th>
                  <th className="text-right px-4 py-3 font-medium">יום צפוי</th>
                  <th className="text-right px-4 py-3 font-medium">סכום צפוי</th>
                  <th className="text-right px-4 py-3 font-medium">סטייה</th>
                  <th className="text-right px-4 py-3 font-medium">מקור חשבונית</th>
                  <th className="text-right px-4 py-3 font-medium">אחראי</th>
                  <th className="text-right px-4 py-3 font-medium">סטטוס</th>
                  <th className="text-right px-4 py-3 font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map((r) => (
                  <tr key={r.id} className={r.status === 'ignored' ? 'text-gray-400' : ''}>
                    <td className="px-4 py-2.5 font-medium" title={r.notes ?? ''}>{r.label}</td>
                    <td className="px-4 py-2.5">
                      {withFreelancer(r.supplierName, r.freelancerName)}
                      {r.aliases.length > 0 && <div className="text-xs text-gray-400" dir="auto">גם: {r.aliases.join(', ')}</div>}
                    </td>
                    <td className="px-4 py-2.5">{CADENCE_LABEL[r.cadence] ?? r.cadence}{r.cadence === 'yearly' && r.expectedMonth ? ` (${MONTH_NAMES[r.expectedMonth - 1]})` : ''}</td>
                    <td className="px-4 py-2.5">{r.expectedDayOfMonth}</td>
                    <td className="px-4 py-2.5">{r.expectedAmount !== null ? ils(r.expectedAmount) : '—'}</td>
                    <td className="px-4 py-2.5">{r.tolerancePct !== null ? `±${r.tolerancePct}%` : 'כל סכום'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1" title={r.instructions ?? ''}>
                        {SOURCE_LABEL[r.invoiceSource] ?? r.invoiceSource}
                        {r.portalUrl && (
                          <a href={r.portalUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800" title="פורטל החשבוניות"><ExternalLink size={14} /></a>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">{r.owner ?? '—'}</td>
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
      </div>
      <Modal isOpen={adding || !!editing} onClose={() => { setAdding(false); setEditing(null); }} title={editing ? 'עריכת ספק' : 'הוספת ספק'}>
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

// ─── Freelancer pay (שכר פרילנסרים) ───────────────────────────────────────────

/** "YYYY-MM" shifted by delta months. */
const shiftMonthKey = (m: string, delta: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};
const israelMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const monthName = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

const RECON_STATUS: Record<FreelancerReconciliationStatus, { label: string; cls: string }> = {
  match: { label: 'התאמה ✅', cls: 'bg-emerald-100 text-emerald-700' },
  mismatch: { label: 'אי-התאמה', cls: 'bg-red-100 text-red-700' },
  missing_invoice: { label: 'חסרה חשבונית', cls: 'bg-red-100 text-red-700' },
  no_activity: { label: 'אין פעילות', cls: 'bg-orange-100 text-orange-700' },
};

function ActivityMonthSelect({ expense }: { expense: CompanyExpense & { activityMonth: string | null } }) {
  const setMonth = useSetExpenseActivityMonth();
  const docMonth = (expense.date ?? expense.reportingDate)?.slice(0, 7) ?? israelMonth();
  // Mirrors backend activityMonthOf: doc dated day ≥ 25 → same month, else the previous one.
  const defaultMonth = expense.date && Number(expense.date.slice(8, 10)) >= 25 ? docMonth : shiftMonthKey(docMonth, -1);
  const options = [-3, -2, -1, 0, 1].map((d) => shiftMonthKey(docMonth, d));
  const override = expense.activityMonthOverride ?? null;
  if (override && !options.includes(override)) options.unshift(override);
  return (
    <select
      className="form-input py-1 text-xs"
      value={override ?? ''}
      disabled={setMonth.isPending}
      onChange={(e) => setMonth.mutate(
        { id: expense.id, activityMonth: e.target.value || null },
        { onError: (err) => alert(errorMessage(err, 'העדכון נכשל')) },
      )}
      title="חודש הפעילות שהחשבונית משלמת עליו"
    >
      <option value="">{`ברירת מחדל (${monthLabel(defaultMonth)})`}</option>
      {options.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
    </select>
  );
}

function ReconciliationRow({ row }: { row: FreelancerReconciliationRow }) {
  const [open, setOpen] = useState(false);
  const bad = row.status !== 'match';
  const st = RECON_STATUS[row.status];
  return (
    <>
      <tr className={`cursor-pointer ${bad ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`} onClick={() => setOpen((v) => !v)}>
        <td className="px-3 py-2.5 text-gray-400">{open ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}</td>
        <td className="px-4 py-2.5">
          <div className="font-medium text-gray-900">{row.name}{!row.isActive && <span className="text-xs text-gray-400"> (לא פעיל)</span>}</div>
          <div className="text-xs text-gray-400 truncate max-w-xs" title={row.suppliers.join(', ')}>
            {row.linked ? row.suppliers.join(' · ') : 'לא משויך ספק במורנינג'}
          </div>
        </td>
        <td className="px-4 py-2.5 whitespace-nowrap">{row.expected.meetings}</td>
        <td className="px-4 py-2.5 whitespace-nowrap">{row.expected.hours}</td>
        <td className="px-4 py-2.5 whitespace-nowrap font-medium" title={`שכר ${ils(row.expected.payment)} · החזרים ${ils(row.expected.expenses)} · תוספות קבועות ${ils(row.expected.fixedAdditions)}`}>
          {ils(row.expected.grandTotal)}
        </td>
        <td className="px-4 py-2.5 whitespace-nowrap">
          {row.invoiced.count ? (
            <span className={row.matchedOn === 'gross' ? 'text-gray-500' : 'font-medium'}>{ils(row.invoiced.net)}</span>
          ) : '—'}
          {row.invoiced.count > 0 && <span className="text-xs text-gray-400"> · {row.invoiced.count} מסמכים</span>}
          {row.invoiced.hasDrafts && <span className={`mr-1 px-1.5 rounded text-[10px] ${DRAFT_BADGE.cls}`}>טיוטה</span>}
        </td>
        <td className="px-4 py-2.5 whitespace-nowrap" title={row.matchedOn === 'gross' ? 'הותאם לפי ברוטו (עוסק מורשה — השכר במערכת כולל מע״מ)' : undefined}>
          {row.invoiced.count ? (
            <span className={row.matchedOn === 'gross' ? 'font-medium' : 'text-gray-500'}>{ils(row.invoiced.gross)}</span>
          ) : '—'}
          {row.matchedOn === 'gross' && <span className="mr-1 px-1.5 rounded text-[10px] bg-emerald-50 text-emerald-700">לפי ברוטו</span>}
        </td>
        <td className={`px-4 py-2.5 whitespace-nowrap font-medium ${bad ? 'text-red-600' : 'text-gray-500'}`} dir="ltr">
          {row.diff > 0 ? '+' : row.diff < 0 ? '−' : ''}{ils(Math.abs(row.diff))}
        </td>
        <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${st.cls}`}>{st.label}</span></td>
      </tr>
      {open && (
        <tr className={bad ? 'bg-red-50/40' : 'bg-gray-50/60'}>
          <td />
          <td colSpan={8} className="px-4 py-3">
            {row.expenses.length === 0 ? (
              <p className="text-sm text-gray-500">אין מסמכים משויכים לחודש זה{row.linked ? '' : ' — שייכו את ספק המורנינג של המדריך בחלק "ספקים לא משויכים" למטה'}.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-gray-500 text-xs">
                  <tr>
                    <th className="text-right py-1 font-medium">תאריך</th>
                    <th className="text-right py-1 font-medium">מס׳ מסמך</th>
                    <th className="text-right py-1 font-medium">ספק</th>
                    <th className="text-right py-1 font-medium">נטו</th>
                    <th className="text-right py-1 font-medium">ברוטו</th>
                    <th className="text-right py-1 font-medium">חודש פעילות</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {row.expenses.map((e) => (
                    <tr key={e.id} onClick={(ev) => ev.stopPropagation()}>
                      <td className="py-1.5 whitespace-nowrap">{fmtDate(e.date)}</td>
                      <td className="py-1.5 text-gray-600">{e.number ?? '—'}{e.isDraft && <span className={`mr-1 px-1.5 rounded text-[10px] ${DRAFT_BADGE.cls}`}>טיוטה</span>}</td>
                      <td className="py-1.5">{e.supplierName ?? '—'}</td>
                      <td className="py-1.5 whitespace-nowrap font-medium">{ils(e.amountExcludeVat ?? e.amount - (e.vat ?? 0))}</td>
                      <td className="py-1.5 whitespace-nowrap text-gray-500">{ils(e.amount)}</td>
                      <td className="py-1.5"><ActivityMonthSelect expense={e} /></td>
                      <td className="py-1.5">
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
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function SuggestionRow({ s, instructors }: {
  s: FreelancerLinkSuggestion;
  instructors: Array<{ id: string; name: string; isActive: boolean }>;
}) {
  const create = useCreateFreelancerLink();
  const [instructorId, setInstructorId] = useState(s.candidates[0]?.instructorId ?? '');
  const suggested = new Set(s.candidates.map((c) => c.instructorId));
  const others = instructors.filter((i) => !suggested.has(i.id));
  return (
    <tr>
      <td className="px-4 py-2.5 font-medium text-gray-900" dir="auto">{s.supplierName}</td>
      <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{s.docCount} מסמכים · {ils(s.gross)}</td>
      <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">{fmtDate(s.lastDate)}</td>
      <td className="px-4 py-2.5">
        <select className="form-input py-1 text-sm" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
          <option value="">בחר מדריך...</option>
          {s.candidates.length > 0 && (
            <optgroup label="מוצעים">
              {s.candidates.map((c) => <option key={c.instructorId} value={c.instructorId}>{c.name}</option>)}
            </optgroup>
          )}
          <optgroup label="כל הפרילנסרים">
            {others.map((i) => <option key={i.id} value={i.id}>{i.name}{i.isActive ? '' : ' (לא פעיל)'}</option>)}
          </optgroup>
        </select>
      </td>
      <td className="px-4 py-2.5">
        <button
          className="btn btn-primary py-1"
          disabled={!instructorId || create.isPending}
          onClick={() => create.mutate(
            { instructorId, supplierId: s.supplierId, supplierName: s.supplierName },
            { onError: (e) => alert(errorMessage(e, 'השיוך נכשל')) },
          )}
        >
          <Link2 size={14} /> שייך
        </button>
      </td>
    </tr>
  );
}

function FreelancerLinksSection() {
  const { data, isLoading } = useFreelancerSuggestions();
  const { data: links } = useFreelancerLinks();
  const remove = useDeleteFreelancerLink();
  const [showAll, setShowAll] = useState(false);
  const all = data?.suggestions ?? [];
  const list = showAll ? all : all.filter((s) => s.candidates.length > 0);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-gray-100">
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">ספקים לא משויכים</h3>
            <p className="text-xs text-gray-500">פרילנסרים מגישים חשבוניות בשם העסק שלהם — שייכו כל ספק במורנינג למדריך כדי שהחשבוניות ייספרו כשכר ולא כהוצאה רגילה.</p>
          </div>
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> הצג את כל הספקים ({all.length})
          </label>
        </div>
        {isLoading ? <Loading /> : list.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">{all.length ? 'אין הצעות שיוך — סמנו "הצג את כל הספקים" לשיוך ידני' : 'כל הספקים משויכים'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-right px-4 py-3 font-medium">ספק במורנינג</th>
                  <th className="text-right px-4 py-3 font-medium">מסמכים (13 חודשים)</th>
                  <th className="text-right px-4 py-3 font-medium">מסמך אחרון</th>
                  <th className="text-right px-4 py-3 font-medium">מדריך</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map((s) => (
                  <SuggestionRow key={`${s.supplierId ?? ''}|${s.supplierName}`} s={s} instructors={data?.instructors ?? []} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">שיוכים קיימים ({links?.length ?? 0})</h3>
        </div>
        {!links?.length ? <div className="p-6 text-center text-gray-400 text-sm">אין שיוכים עדיין</div> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {[...links].sort((a, b) => (a.instructorName ?? '').localeCompare(b.instructorName ?? '', 'he')).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span>
                  <span className="font-medium text-gray-900">{l.instructorName ?? '—'}</span>
                  <span className="text-gray-400"> ← </span>
                  <span className="text-gray-700" dir="auto">{l.supplierName}</span>
                  {!l.supplierId && <span className="text-xs text-gray-400"> (לפי שם)</span>}
                </span>
                <button
                  className="text-gray-400 hover:text-red-600"
                  title="הסר שיוך"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm(`להסיר את השיוך של "${l.supplierName}" ל${l.instructorName ?? 'מדריך'}?`)) {
                      remove.mutate(l.id, { onError: (e) => alert(errorMessage(e, 'ההסרה נכשלה')) });
                    }
                  }}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FreelancersTab() {
  const [month, setMonth] = useState(() => shiftMonthKey(israelMonth(), -1));
  const { data, isLoading, isFetching } = useFreelancerReconciliation(month);
  const t = data?.totals;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-gray-100">
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Users size={18} className="text-blue-600" /> שכר פרילנסרים — {monthName(month)}</h3>
            <p className="text-xs text-gray-500">
              צפוי = סה״כ לתשלום בדוח השכר החודשי (שכר + החזרים + תוספות קבועות). התאמה = הנטו או הברוטו של החשבוניות המשויכות תואם לצפוי
              (עוסק מורשה — השכר במערכת כולל מע״מ). מסמך מתאריך 25 ומעלה משויך לאותו חודש, ומוקדם יותר — לחודש שלפניו; ניתן לשנות בכל מסמך.
            </p>
          </div>
          <button className="btn btn-secondary py-1" onClick={() => setMonth((m) => shiftMonthKey(m, -1))} title="חודש קודם">‹</button>
          <input type="month" className="form-input" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <button className="btn btn-secondary py-1" onClick={() => setMonth((m) => shiftMonthKey(m, 1))} title="חודש הבא">›</button>
          {isFetching && !isLoading && <RefreshCw size={14} className="animate-spin text-gray-400" />}
        </div>
        {t && (
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
            <span>צפוי: <b className="text-gray-900">{ils(t.expected)}</b></span>
            <span>מחויב: נטו <b className="text-gray-900">{ils(t.invoicedNet)}</b> · ברוטו <b className="text-gray-900">{ils(t.invoicedGross)}</b></span>
            <span>הפרש: <b className={Math.abs(t.diff) > 5 ? 'text-red-600' : 'text-gray-900'} dir="ltr">{t.diff > 0 ? '+' : t.diff < 0 ? '−' : ''}{ils(Math.abs(t.diff))}</b></span>
            <span>{t.problems ? <span className="text-red-600 font-medium">{t.problems} דורשים בדיקה</span> : <span className="text-emerald-600">הכל תואם</span>}</span>
          </div>
        )}
        {isLoading ? <Loading /> : !data?.rows.length ? (
          <div className="p-8 text-center text-gray-400">אין פעילות פרילנסרים או חשבוניות בחודש זה</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="w-8" />
                  <th className="text-right px-4 py-3 font-medium">מדריך</th>
                  <th className="text-right px-4 py-3 font-medium">מפגשים</th>
                  <th className="text-right px-4 py-3 font-medium">שעות</th>
                  <th className="text-right px-4 py-3 font-medium">צפוי לתשלום</th>
                  <th className="text-right px-4 py-3 font-medium">חויב (נטו)</th>
                  <th className="text-right px-4 py-3 font-medium">חויב (ברוטו)</th>
                  <th className="text-right px-4 py-3 font-medium">הפרש</th>
                  <th className="text-right px-4 py-3 font-medium">סטטוס</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.rows.map((r) => <ReconciliationRow key={r.instructorId} row={r} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <FreelancerLinksSection />
    </div>
  );
}

export default function CompanyExpenses() {
  const [tab, setTab] = useState<Tab>('overview');
  const { data: summary, isLoading, error } = useCompanyExpenseSummary();
  const { data: missing } = useMissingRecurringExpenses();
  const sync = useSyncCompanyExpenses();
  const { data: recurringRows } = useRecurringExpenses();
  const [showUpload, setShowUpload] = useState(false);
  const activeSuppliers = (recurringRows ?? []).filter((r) => r.status === 'active').sort((a, b) => a.label.localeCompare(b.label, 'he'));

  const handleSync = (full = false) =>
    sync.mutate(full, {
      onSuccess: (r) => alert(`סונכרנו ${r.fetched} הוצאות (${r.created} חדשות, ${r.updated} עודכנו)${r.newRecurringSuggestions ? ` · ${r.newRecurringSuggestions} הצעות חדשות לחשבוניות קבועות` : ''}`),
      onError: (e) => alert(errorMessage(e, 'הסנכרון נכשל')),
    });

  const k = summary?.kpis;
  // KPIs/chart: other expenses by reporting month + freelancer pay by activity month (salary report).
  const thisOv = k?.thisMonthOverview;
  const lastOv = k?.lastMonthOverview;
  const diff = thisOv && lastOv?.gross ? ((thisOv.gross - lastOv.gross) / lastOv.gross) * 100 : null;
  const freelancerSub = (o: NonNullable<typeof thisOv>) =>
    `שאר ההוצאות ${ils(o.other.gross)} · פרילנסרים: ${ils(o.freelancerExpected)} לפי דוח שכר · התקבלו קבלות ${ils(o.freelancerInvoicedGross)}`;
  const chartData = (summary?.months ?? []).map((m) => ({
    label: monthLabel(m.month),
    otherGross: m.otherGross ?? Math.round((m.gross - (m.freelancerGross ?? 0)) * 100) / 100,
    freelancerExpected: m.freelancerExpected ?? 0,
    freelancerInvoicedGross: m.freelancerInvoicedGross ?? 0,
  }));
  const categoryData = (summary?.byCategory ?? []).slice(0, 10);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'סקירה' },
    { key: 'expenses', label: 'כל ההוצאות' },
    { key: 'pending', label: `טרם דווחו${k?.pendingCount ? ` (${k.pendingCount})` : ''}` },
    { key: 'recurring', label: 'ספקים' },
    { key: 'freelancers', label: 'שכר פרילנסרים' },
  ];

  return (
    <>
      <PageHeader
        title="הוצאות החברה"
        subtitle={`נתונים ממורנינג · סנכרון אחרון: ${fmtDateTime(summary?.lastSyncedAt ?? null)}`}
        actions={
          <div className="flex gap-2">
          <button onClick={() => setShowUpload((v) => !v)} className="btn btn-secondary" title="העלאת חשבוניות ישירות למורנינג">
            <Upload size={18} /> העלאת חשבוניות
          </button>
          <button
            onClick={() => handleSync(!summary?.lastSyncedAt)}
            disabled={sync.isPending || summary?.syncRunning}
            className="btn btn-primary"
            title="משיכת הוצאות מעודכנות ממורנינג (60 הימים האחרונים; בסנכרון ראשון — 13 חודשים)"
          >
            <RefreshCw size={18} className={sync.isPending ? 'animate-spin' : ''} /> {sync.isPending ? 'מסנכרן...' : 'רענן עכשיו'}
          </button>
          </div>
        }
      />

      <div className="flex-1 p-6 overflow-auto space-y-6">
        {showUpload && <UploadPanel suppliers={activeSuppliers} />}
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
                value={ils(thisOv?.gross ?? k!.thisMonth.gross)}
                sub={thisOv
                  ? `${freelancerSub(thisOv)}${diff !== null ? ` · ${diff >= 0 ? '+' : ''}${Math.round(diff)}% מהחודש הקודם` : ''}`
                  : `נטו ${ils(k!.thisMonth.net)} · ${k!.thisMonth.count} מסמכים`}
                tone="bg-blue-50 text-blue-600"
                icon={Wallet}
              />
              <KpiCard
                title="חודש קודם"
                value={ils(lastOv?.gross ?? k!.lastMonth.gross)}
                sub={lastOv ? freelancerSub(lastOv) : `נטו ${ils(k!.lastMonth.net)} · ${k!.lastMonth.count} מסמכים`}
                tone="bg-slate-50 text-slate-600"
                icon={diff !== null && diff < 0 ? TrendingDown : TrendingUp}
              />
              <KpiCard
                title="ממוצע 3 חודשים"
                value={ils(k!.threeMonthAvgOverview?.gross ?? k!.threeMonthAvg.gross)}
                sub="3 החודשים המלאים האחרונים · פרילנסרים לפי דוח שכר"
                tone="bg-violet-50 text-violet-600"
                icon={TrendingUp}
              />
              <KpiCard title="אושרו לדוח – טרם דווחו" value={String(k!.pendingCount)} sub={`סה״כ ${ils(k!.pendingGross)}`} tone="bg-amber-50 text-amber-600" icon={Clock} />
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
                  <h3 className="font-semibold text-gray-900 mb-1">הוצאות לפי חודש (12 חודשים, ברוטו)</h3>
                  <p className="text-xs text-gray-500 mb-3">שכר פרילנסרים לפי חודש הפעילות (דוח השכר); הקו — קבלות פרילנסרים שהתקבלו עבור אותו חודש פעילות.</p>
                  <div className="h-72" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₪${Math.round(v / 1000)}k`} />
                        <Tooltip formatter={(v) => ils(Number(v))} />
                        <Legend />
                        <Bar dataKey="otherGross" name="שאר ההוצאות" stackId="month" fill="#3b82f6" />
                        <Bar dataKey="freelancerExpected" name="שכר פרילנסרים (לפי דוח שכר)" stackId="month" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                        <Line dataKey="freelancerInvoicedGross" name="קבלות פרילנסרים שהתקבלו" type="monotone" stroke="#b45309" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">ההוצאות השכיחות (12 חודשים, ללא פרילנסרים)</h3>
                  {summary.topSuppliers.length === 0 ? <p className="text-sm text-gray-400">אין נתונים</p> : (
                    <ul className="space-y-2 text-sm">
                      {summary.topSuppliers.map((s, i) => (
                        <li key={`${s.supplierId ?? s.supplierName}-${i}`} className="flex items-center justify-between gap-2">
                          <span className="truncate"><span className="text-gray-400 ml-1">{i + 1}.</span>{withFreelancer(s.supplierName, s.freelancerName)}</span>
                          <span className="font-medium whitespace-nowrap">{s.count} מסמכים <span className="text-xs text-gray-400">({ils(s.gross)})</span></span>
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
                  {summary.pending.length ? `${summary.pending.length} הוצאות אושרו לדוח במורנינג וטרם דווחו (${ils(k!.pendingGross)})` : 'אין הוצאות שטרם דווחו'}
                </div>
                <ExpensesTable rows={summary.pending} />
              </div>
            )}

            {tab === 'recurring' && <SuppliersTab />}

            {tab === 'freelancers' && <FreelancersTab />}
          </>
        )}
      </div>
    </>
  );
}
