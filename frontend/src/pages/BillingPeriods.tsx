import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ExternalLink, RefreshCcw, AlertCircle } from 'lucide-react';
import { api } from '../api/client';
import PageHeader from '../components/ui/PageHeader';

interface BillingPeriod {
  id: string;
  month: string;
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
  institutionalOrder: { id: string; orderName: string | null; taxId: string | null };
  _count: { lines: number };
}

interface InstitutionalOrder {
  id: string;
  orderName: string | null;
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

function monthLabel(iso: string) {
  const d = new Date(iso);
  return `${HEBREW_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function defaultMonth() {
  const d = new Date();
  // Default to PREVIOUS month for billing
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const m = d.getMonth() === 0 ? 12 : d.getMonth();
  return `${y}-${String(m).padStart(2, '0')}`;
}

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
  const [genMonth, setGenMonth] = useState(defaultMonth());
  const [genAll, setGenAll] = useState(false);

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
    api.get('/institutional-orders?limit=200').then(({ data }) => {
      setOrders(data.data || data);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter, overdueOnly]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGenerating(true);
    try {
      if (genAll) {
        const { data } = await api.post('/billing/generate-all', { month: genMonth });
        alert(`נוצרו: ${data.created} · דולגו (קיימים): ${data.skipped} · ריקים: ${data.empty} · שגיאות: ${data.errors.length}`);
      } else {
        if (!genOrderId) { setError('בחר מוסד'); return; }
        await api.post('/billing/generate', { institutionalOrderId: genOrderId, month: genMonth });
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
          <div className="md:col-span-2">
            <label className="form-label">מוסד</label>
            <select className="form-input" value={genOrderId} onChange={(e) => setGenOrderId(e.target.value)} disabled={genAll}>
              <option value="">— בחר מוסד —</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>{o.orderName || o.branch?.name || o.id.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">חודש לחיוב</label>
            <input type="month" className="form-input" value={genMonth} onChange={(e) => setGenMonth(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={genAll} onChange={(e) => setGenAll(e.target.checked)} />
              לכל המוסדות הפעילים
            </label>
            <button type="submit" disabled={generating}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 justify-center disabled:opacity-50">
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
                <th className="text-right p-3">מוסד</th>
                <th className="text-right p-3">חודש</th>
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
              {periods.map((p) => {
                const isOverdue = p.status === 'issued' && p.dueDate && new Date(p.dueDate) < new Date() && p.paymentStatus !== 'paid';
                return (
                <tr key={p.id} className={`border-b last:border-b-0 hover:bg-gray-50 ${isOverdue ? 'bg-red-50' : ''}`}>
                  <td className="p-3">
                    <div className="font-medium">{p.institutionalOrder.orderName || '—'}</div>
                    {!p.institutionalOrder.taxId && (
                      <div className="text-xs text-amber-600 mt-1">⚠️ חסר ת.ז עוסק</div>
                    )}
                  </td>
                  <td className="p-3">{monthLabel(p.month)}</td>
                  <td className="p-3">{p._count.lines}</td>
                  <td className="p-3">{Number(p.totalAmount).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</td>
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
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
