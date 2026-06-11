import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ExternalLink, RefreshCcw, AlertCircle, X, Search, ChevronDown, ChevronLeft } from 'lucide-react';
import { api } from '../api/client';
import PageHeader from '../components/ui/PageHeader';

interface BillingPeriod {
  id: string;
  monthStart: string;
  monthEnd: string;
  status: 'draft' | 'issued' | 'cancelled';
  totalAmount: number | string;
  morningDocNumber: number | null;
  morningDocUrl: string | null;
  generatedAt: string;
  issuedAt: string | null;
  dueDate: string | null;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  paidAmount: number | string;
  sentAt: string | null;
  institutionalOrder: { id: string; orderName: string | null; taxId: string | null; morningClientName?: string | null };
  _count: { lines: number };
}

interface InstitutionalOrder {
  id: string;
  orderName: string | null;
  payingBody?: string | null;
  branch?: { name: string | null };
}

const STATUS_HE: Record<string, string> = {
  draft: 'טיוטה',
  issued: 'הופק',
  cancelled: 'בוטלה',
};
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  issued: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};
const PAY_HE: Record<string, string> = { unpaid: 'טרם שולם', partial: 'חלקי', paid: 'שולם' };
const PAY_COLOR: Record<string, string> = {
  unpaid: 'bg-red-100 text-red-700',
  partial: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
};

const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function rangeLabel(startIso: string, endIso: string) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sm = HEBREW_MONTHS[s.getUTCMonth()], sy = s.getUTCFullYear();
  const em = HEBREW_MONTHS[e.getUTCMonth()], ey = e.getUTCFullYear();
  if (sy === ey && s.getUTCMonth() === e.getUTCMonth()) return `${sm} ${sy}`;
  if (sy === ey) return `${sm}–${em} ${sy}`;
  return `${sm} ${sy} – ${em} ${ey}`;
}

function defaultMonth() {
  const d = new Date();
  // Default to PREVIOUS month for billing
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const m = d.getMonth() === 0 ? 12 : d.getMonth();
  return `${y}-${String(m).padStart(2, '0')}`;
}

function periodOverdue(p: BillingPeriod) {
  return p.status === 'issued' && !!p.dueDate && new Date(p.dueDate) < new Date() && p.paymentStatus !== 'paid';
}

const ILS = (n: number) => n.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' });

export default function BillingPeriods() {
  const [periods, setPeriods] = useState<BillingPeriod[]>([]);
  const [orders, setOrders] = useState<InstitutionalOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generation form
  const [genOrderId, setGenOrderId] = useState('');
  const [genMonthStart, setGenMonthStart] = useState(defaultMonth());
  const [genMonthEnd, setGenMonthEnd] = useState(defaultMonth());
  const [genAll, setGenAll] = useState(false);

  // Institution picker (searchable combobox)
  const [orderSearch, setOrderSearch] = useState('');
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);
  const orderPickerRef = useRef<HTMLDivElement>(null);

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const name = (o.orderName || '').toLowerCase();
      const branch = (o.branch?.name || '').toLowerCase();
      const payingBody = (o.payingBody || '').toLowerCase();
      return name.includes(q) || branch.includes(q) || payingBody.includes(q);
    });
  }, [orders, orderSearch]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === genOrderId) || null,
    [orders, genOrderId]
  );

  // Group periods by institution (מוסד). Each group carries aggregates for its header.
  const groups = useMemo(() => {
    const map = new Map<string, {
      id: string; name: string; taxId: string | null; periods: BillingPeriod[];
    }>();
    for (const p of periods) {
      const key = p.institutionalOrder.id;
      let g = map.get(key);
      if (!g) {
        // Prefer the Morning client name (matches the issued document exactly); fall back to
        // the internal order name until a document has been issued for this institution.
        const name = p.institutionalOrder.morningClientName || p.institutionalOrder.orderName || '—';
        g = { id: key, name, taxId: p.institutionalOrder.taxId, periods: [] };
        map.set(key, g);
      }
      g.periods.push(p);
    }
    return Array.from(map.values()).map((g) => ({
      ...g,
      count: g.periods.length,
      draftCount: g.periods.filter((p) => p.status === 'draft').length,
      total: g.periods.reduce((s, p) => s + Number(p.totalAmount), 0),
      hasOverdue: g.periods.some(periodOverdue),
    })).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [periods]);

  // Collapse overrides keyed by institution id; falls back to a data-driven default
  // (open when the group has drafts or overdue charges that need attention).
  const [collapseOverrides, setCollapseOverrides] = useState<Record<string, boolean>>({});
  const isOpen = (g: { id: string; draftCount: number; hasOverdue: boolean }) =>
    collapseOverrides[g.id] ?? (g.draftCount > 0 || g.hasOverdue);
  const toggleGroup = (g: { id: string; draftCount: number; hasOverdue: boolean }) =>
    setCollapseOverrides((prev) => ({ ...prev, [g.id]: !isOpen(g) }));

  useEffect(() => {
    if (!orderPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (orderPickerRef.current && !orderPickerRef.current.contains(e.target as Node)) {
        setOrderPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [orderPickerOpen]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (overdueOnly) params.set('overdue', 'true');
      const qs = params.toString() ? `?${params}` : '';
      const { data } = await api.get(`/billing${qs}`);
      setPeriods(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.get('/institutional-orders?limit=5000&forBilling=true').then(({ data }) => {
      setOrders(data.data || data);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter, overdueOnly]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (genMonthEnd < genMonthStart) {
      setError('חודש סיום חייב להיות אחרי חודש התחלה');
      return;
    }
    setGenerating(true);
    try {
      if (genAll) {
        // Bulk cron-equivalent runs single-month only; use monthStart as the target month.
        const { data } = await api.post('/billing/generate-all', { month: genMonthStart });
        alert(`נוצרו: ${data.created} · דולגו (קיימים): ${data.skipped} · ריקים: ${data.empty} · שגיאות: ${data.errors.length}`);
      } else {
        if (!genOrderId) { setError('בחר מוסד'); return; }
        await api.post('/billing/generate', {
          institutionalOrderId: genOrderId,
          monthStart: genMonthStart,
          monthEnd: genMonthEnd,
        });
      }
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'שגיאה לא ידועה');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <PageHeader
        title="חשבונות חודשיים — לקוחות מוסדיים"
        subtitle="ייצור drafts לפי הפגישות שהתקיימו, עריכה, אישור והפקה למורנינג"
      />

      <section className="bg-white rounded-xl border p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">צור draft חדש</h2>
        <form onSubmit={generate} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2 relative" ref={orderPickerRef}>
            <label className="form-label">מוסד</label>
            <div className="relative">
              <button
                type="button"
                disabled={genAll}
                onClick={() => setOrderPickerOpen((v) => !v)}
                className="form-input w-full text-right disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between gap-2"
              >
                <span className={selectedOrder ? '' : 'text-gray-400'}>
                  {selectedOrder
                    ? selectedOrder.orderName || selectedOrder.branch?.name || selectedOrder.id.slice(0, 8)
                    : '— בחר מוסד —'}
                </span>
                {selectedOrder && !genAll && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setGenOrderId(''); setOrderSearch(''); }}
                    className="text-gray-400 hover:text-gray-700"
                    aria-label="נקה בחירה"
                  >
                    <X size={14} />
                  </span>
                )}
              </button>
              {orderPickerOpen && !genAll && (
                <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-80 overflow-hidden flex flex-col">
                  <div className="p-2 border-b flex items-center gap-2">
                    <Search size={16} className="text-gray-400" />
                    <input
                      autoFocus
                      type="text"
                      placeholder="חפש מוסד..."
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                      className="flex-1 outline-none text-sm"
                    />
                  </div>
                  <div className="overflow-y-auto">
                    {filteredOrders.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500 text-center">אין תוצאות</div>
                    ) : (
                      filteredOrders.map((o) => {
                        const label = o.orderName || o.branch?.name || o.id.slice(0, 8);
                        const sub = o.orderName && o.branch?.name && o.orderName !== o.branch.name ? o.branch.name : null;
                        return (
                          <button
                            type="button"
                            key={o.id}
                            onClick={() => { setGenOrderId(o.id); setOrderPickerOpen(false); setOrderSearch(''); }}
                            className={`w-full text-right px-3 py-2 hover:bg-blue-50 text-sm border-b last:border-b-0 ${o.id === genOrderId ? 'bg-blue-50 font-medium' : ''}`}
                          >
                            <div>{label}</div>
                            {sub && <div className="text-xs text-gray-500">{sub}</div>}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="form-label">מחודש</label>
            <input
              type="month"
              className="form-input"
              value={genMonthStart}
              onChange={(e) => {
                setGenMonthStart(e.target.value);
                if (genMonthEnd < e.target.value) setGenMonthEnd(e.target.value);
              }}
              required
            />
          </div>
          <div>
            <label className="form-label">עד חודש</label>
            <input
              type="month"
              className="form-input"
              value={genMonthEnd}
              min={genMonthStart}
              onChange={(e) => setGenMonthEnd(e.target.value)}
              required
              disabled={genAll}
              title={genAll ? 'יצירה גורפת תומכת רק בחודש בודד' : ''}
            />
          </div>
          <div className="flex flex-col gap-2 md:col-span-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={genAll} onChange={(e) => setGenAll(e.target.checked)} />
              לכל המוסדות הפעילים (חודש בודד בלבד — לפי "מחודש")
            </label>
            <button type="submit" disabled={generating}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 justify-center disabled:opacity-50 self-start">
              <Plus size={16} /> {generating ? 'יוצר...' : 'צור draft'}
            </button>
          </div>
        </form>
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800 flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-gray-900">רשימת חשבונות חודשיים</h2>
          <div className="flex items-center gap-2">
            <select className="form-input !w-40" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setOverdueOnly(false); }}>
              <option value="">כל הסטטוסים</option>
              <option value="draft">טיוטות</option>
              <option value="issued">הופק</option>
              <option value="cancelled">בוטלו</option>
            </select>
            <label className="flex items-center gap-1 text-sm text-red-700 font-medium whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked); if (e.target.checked) setStatusFilter(''); }} />
              פגי תוקף
            </label>
            {groups.length > 0 && (
              <>
                <button
                  onClick={() => setCollapseOverrides(Object.fromEntries(groups.map((g) => [g.id, true])))}
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                >פתח הכל</button>
                <button
                  onClick={() => setCollapseOverrides(Object.fromEntries(groups.map((g) => [g.id, false])))}
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                >כווץ הכל</button>
              </>
            )}
            <button onClick={load} className="text-gray-600 hover:text-gray-900 p-2"><RefreshCcw size={18} /></button>
          </div>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-500">טוען...</div>
        ) : periods.length === 0 ? (
          <div className="p-8 text-center text-gray-500">אין רשומות</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-600 border-b bg-gray-50">
              <tr>
                <th className="text-right p-3">תקופה</th>
                <th className="text-right p-3">שורות</th>
                <th className="text-right p-3">סכום (נטו)</th>
                <th className="text-right p-3">סטטוס</th>
                <th className="text-right p-3">תשלום</th>
                <th className="text-right p-3">לתשלום עד</th>
                <th className="text-right p-3">מסמך מורנינג</th>
                <th className="text-right p-3"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const open = isOpen(g);
                return (
                <Fragment key={g.id}>
                  <tr
                    className="border-b bg-gray-50/70 hover:bg-gray-100 cursor-pointer select-none"
                    onClick={() => toggleGroup(g)}
                  >
                    <td className="p-3" colSpan={8}>
                      <div className="flex items-center gap-2 flex-wrap">
                        {open ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronLeft size={16} className="text-gray-500" />}
                        <span className="font-semibold text-gray-900">{g.name}</span>
                        {!g.taxId && <span className="text-xs text-amber-600">⚠️ חסר ת.ז עוסק</span>}
                        <span className="text-xs bg-gray-200 text-gray-700 rounded-full px-2 py-0.5">{g.count} חשבונות</span>
                        {g.draftCount > 0 && (
                          <span className="text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-0.5">{g.draftCount} טיוטות</span>
                        )}
                        {g.hasOverdue && (
                          <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-medium">פגי תוקף</span>
                        )}
                        <span className="text-xs text-gray-600 mr-auto">סה״כ {ILS(g.total)}</span>
                      </div>
                    </td>
                  </tr>
                  {open && g.periods.map((p) => {
                    const isOverdue = periodOverdue(p);
                    return (
                    <tr key={p.id} className={`border-b last:border-b-0 hover:bg-gray-50 ${isOverdue ? 'bg-red-50' : ''}`}>
                      <td className="p-3 pr-8">{rangeLabel(p.monthStart, p.monthEnd)}</td>
                      <td className="p-3">{p._count.lines}</td>
                      <td className="p-3">{ILS(Number(p.totalAmount))}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLOR[p.status]}`}>{STATUS_HE[p.status]}</span>
                      </td>
                      <td className="p-3">
                        {p.status === 'issued' ? (
                          <span className={`px-2 py-1 rounded text-xs font-medium ${PAY_COLOR[p.paymentStatus]}`}>
                            {PAY_HE[p.paymentStatus]}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="p-3 text-sm">
                        {p.dueDate ? (
                          <span className={isOverdue ? 'text-red-700 font-semibold' : ''}>
                            {new Date(p.dueDate).toLocaleDateString('he-IL')}
                            {isOverdue && ' ⚠️'}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="p-3">
                        {p.morningDocNumber ? (
                          <div className="flex items-center gap-2">
                            <span className="font-medium">#{p.morningDocNumber}</span>
                            {p.morningDocUrl && (
                              <a href={p.morningDocUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                <ExternalLink size={14} />
                              </a>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="p-3 text-left">
                        <Link to={`/billing/${p.id}`} className="text-blue-600 hover:underline text-sm">פתח →</Link>
                      </td>
                    </tr>
                    );
                  })}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
