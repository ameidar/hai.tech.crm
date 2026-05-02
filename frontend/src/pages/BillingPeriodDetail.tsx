import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight, Plus, Trash2, Eye, Send, AlertCircle, CheckCircle2, ExternalLink, X } from 'lucide-react';
import { api } from '../api/client';
import PageHeader from '../components/ui/PageHeader';

interface Line {
  id: string;
  cycleId: string | null;
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  total: string | number;
  sortOrder: number;
}

interface Period {
  id: string;
  month: string;
  status: 'draft' | 'issued' | 'cancelled';
  totalAmount: string | number;
  notes: string | null;
  sendByEmail: boolean;
  morningDocNumber: number | null;
  morningDocUrl: string | null;
  morningDocId: string | null;
  issuedAt: string | null;
  institutionalOrder: {
    id: string;
    orderName: string | null;
    taxId: string | null;
    contactEmail: string | null;
    contactName: string | null;
    address: string | null;
    city: string | null;
    branch?: { name: string | null };
  };
  lines: Line[];
}

const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
function monthLabel(iso: string) {
  const d = new Date(iso);
  return `${HEBREW_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export default function BillingPeriodDetail() {
  const { id } = useParams<{ id: string }>();
  const [period, setPeriod] = useState<Period | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Inline editor state for new line
  const [newLine, setNewLine] = useState({ description: '', quantity: '1', unitPrice: '0' });
  const [showAddLine, setShowAddLine] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/billing/${id}`);
      setPeriod(data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  function handleErr(err: any) {
    const msg = err.response?.data?.details?.errorMessage
      || err.response?.data?.error
      || err.message
      || 'שגיאה';
    setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  async function updateLine(lineId: string, patch: Partial<Pick<Line, 'description' | 'quantity' | 'unitPrice'>>) {
    setError(null);
    try {
      await api.put(`/billing/${id}/lines/${lineId}`, {
        ...patch,
        ...(patch.quantity !== undefined && { quantity: Number(patch.quantity) }),
        ...(patch.unitPrice !== undefined && { unitPrice: Number(patch.unitPrice) }),
      });
      await load();
    } catch (err) { handleErr(err); }
  }

  async function deleteLine(lineId: string) {
    if (!confirm('למחוק את השורה?')) return;
    setError(null);
    try {
      await api.delete(`/billing/${id}/lines/${lineId}`);
      await load();
    } catch (err) { handleErr(err); }
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/billing/${id}/lines`, {
        description: newLine.description,
        quantity: Number(newLine.quantity),
        unitPrice: Number(newLine.unitPrice),
      });
      setNewLine({ description: '', quantity: '1', unitPrice: '0' });
      setShowAddLine(false);
      await load();
    } catch (err) { handleErr(err); }
  }

  async function updateNotesAndEmail(patch: { notes?: string; sendByEmail?: boolean }) {
    setError(null);
    try {
      await api.put(`/billing/${id}`, patch);
      await load();
    } catch (err) { handleErr(err); }
  }

  async function preview() {
    setError(null);
    setBusy(true);
    try {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const { data } = await api.post(`/billing/${id}/preview`);
      const binary = atob(data.fileBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      window.open(url, '_blank');
    } catch (err) { handleErr(err); } finally { setBusy(false); }
  }

  async function issue() {
    if (!confirm('להפיק חשבון עסקה אמיתי במורנינג? אי אפשר לבטל מסמך שהופק (רק לסגור ב-UI).')) return;
    setError(null);
    setBusy(true);
    try {
      await api.post(`/billing/${id}/issue`);
      await load();
    } catch (err) { handleErr(err); } finally { setBusy(false); }
  }

  async function cancelDraft() {
    if (!confirm('לבטל את ה-draft? לא ייווצר רישום במורנינג.')) return;
    setError(null);
    try {
      await api.post(`/billing/${id}/cancel`);
      await load();
    } catch (err) { handleErr(err); }
  }

  async function regenerate() {
    if (!period) return;
    if (!confirm('לרענן מתוך הפגישות? כל העריכות הידניות לשורות ימחקו.')) return;
    setError(null);
    setBusy(true);
    try {
      const month = period.month.slice(0, 7); // YYYY-MM
      await api.post('/billing/generate', { institutionalOrderId: period.institutionalOrder.id, month });
      await load();
    } catch (err) { handleErr(err); } finally { setBusy(false); }
  }

  if (loading) return <div className="p-6 text-center text-gray-500">טוען...</div>;
  if (!period) return <div className="p-6 text-center text-red-600">{error || 'לא נמצא'}</div>;

  const isDraft = period.status === 'draft';
  const order = period.institutionalOrder;
  const missingTaxId = !order.taxId;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <Link to="/billing" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowRight size={14} /> חזור לרשימה
      </Link>

      <PageHeader
        title={`חשבון חודשי — ${order.orderName || 'מוסד'}`}
        subtitle={`${monthLabel(period.month)} · סטטוס: ${period.status === 'draft' ? 'טיוטה' : period.status === 'issued' ? 'הופק' : 'בוטלה'}`}
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" /> <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {period.status === 'issued' && (
        <div className="bg-green-50 border border-green-200 rounded p-4 flex items-start gap-3">
          <CheckCircle2 className="text-green-600 mt-0.5" size={20} />
          <div className="flex-1">
            <h3 className="font-semibold text-green-900">המסמך הופק במורנינג</h3>
            <p className="text-sm text-green-800 mt-1">
              מספר: <b>{period.morningDocNumber}</b>
              {period.issuedAt && <> · תאריך הפקה: {new Date(period.issuedAt).toLocaleString('he-IL')}</>}
            </p>
            {period.morningDocUrl && (
              <a href={period.morningDocUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-green-700 hover:underline text-sm mt-2">
                <ExternalLink size={14} /> פתח PDF
              </a>
            )}
          </div>
        </div>
      )}

      {missingTaxId && isDraft && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <div>
            <b>חסר ת.ז עוסק / ח.פ</b> — מורנינג ידחה את ההפקה. תיכנס ל
            <Link to={`/institutional-orders`} className="underline mx-1">עמוד המוסד</Link>
            ותעדכן את שדה taxId לפני שתפיק.
          </div>
        </div>
      )}

      <section className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-gray-900 mb-3">פרטי לקוח (יוצגו בחשבון עסקה)</h2>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div><dt className="text-gray-500">שם</dt><dd>{order.orderName || '—'}</dd></div>
          <div><dt className="text-gray-500">ת.ז עוסק</dt><dd className={!order.taxId ? 'text-amber-600' : ''}>{order.taxId || '⚠️ חסר'}</dd></div>
          <div><dt className="text-gray-500">איש קשר</dt><dd>{order.contactName || '—'}</dd></div>
          <div><dt className="text-gray-500">מייל</dt><dd dir="ltr">{order.contactEmail || '—'}</dd></div>
          <div><dt className="text-gray-500">כתובת</dt><dd>{order.address || '—'}</dd></div>
          <div><dt className="text-gray-500">עיר</dt><dd>{order.city || '—'}</dd></div>
        </dl>
      </section>

      <section className="bg-white rounded-xl border">
        <div className="p-5 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">שורות חשבון</h2>
          {isDraft && (
            <div className="flex items-center gap-2">
              <button onClick={regenerate} disabled={busy}
                className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1 rounded border">רענן מהפגישות</button>
              <button onClick={() => setShowAddLine(true)}
                className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded border inline-flex items-center gap-1">
                <Plus size={14} /> הוסף שורה
              </button>
            </div>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="text-gray-600 border-b bg-gray-50">
            <tr>
              <th className="text-right p-3">תיאור</th>
              <th className="text-right p-3 w-24">כמות</th>
              <th className="text-right p-3 w-32">מחיר ליחידה</th>
              <th className="text-right p-3 w-32">סכום</th>
              {isDraft && <th className="w-12"></th>}
            </tr>
          </thead>
          <tbody>
            {period.lines.map((line) => (
              <tr key={line.id} className="border-b last:border-b-0">
                <td className="p-2">
                  {isDraft ? (
                    <input className="form-input" defaultValue={line.description}
                      onBlur={(e) => e.target.value !== line.description && updateLine(line.id, { description: e.target.value })} />
                  ) : <span>{line.description}</span>}
                </td>
                <td className="p-2">
                  {isDraft ? (
                    <input type="number" step="0.5" className="form-input" defaultValue={Number(line.quantity)}
                      onBlur={(e) => Number(e.target.value) !== Number(line.quantity) && updateLine(line.id, { quantity: e.target.value as any })} />
                  ) : Number(line.quantity)}
                </td>
                <td className="p-2">
                  {isDraft ? (
                    <input type="number" step="0.01" className="form-input" defaultValue={Number(line.unitPrice)}
                      onBlur={(e) => Number(e.target.value) !== Number(line.unitPrice) && updateLine(line.id, { unitPrice: e.target.value as any })} />
                  ) : Number(line.unitPrice).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}
                </td>
                <td className="p-2 font-medium">
                  {Number(line.total).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}
                </td>
                {isDraft && (
                  <td className="p-2">
                    <button onClick={() => deleteLine(line.id)} className="text-red-600 hover:text-red-800">
                      <Trash2 size={16} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {period.lines.length === 0 && (
              <tr><td colSpan={isDraft ? 5 : 4} className="text-center text-gray-500 p-6">אין שורות</td></tr>
            )}
          </tbody>
          <tfoot className="font-bold">
            <tr><td colSpan={isDraft ? 3 : 2} className="p-3 text-left">סה״כ נטו (ללא מע״מ):</td>
                <td className="p-3">{Number(period.totalAmount).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</td>
                {isDraft && <td/>}</tr>
            <tr className="text-gray-600"><td colSpan={isDraft ? 3 : 2} className="p-3 text-left">+ מע״מ 18%:</td>
                <td className="p-3">{(Number(period.totalAmount) * 0.18).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</td>
                {isDraft && <td/>}</tr>
            <tr className="text-base"><td colSpan={isDraft ? 3 : 2} className="p-3 text-left">סה״כ לתשלום:</td>
                <td className="p-3">{(Number(period.totalAmount) * 1.18).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</td>
                {isDraft && <td/>}</tr>
          </tfoot>
        </table>
      </section>

      {showAddLine && isDraft && (
        <form onSubmit={addLine} className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">שורה ידנית חדשה</h3>
            <button type="button" onClick={() => setShowAddLine(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-3">
              <label className="form-label">תיאור</label>
              <input className="form-input" required value={newLine.description}
                onChange={(e) => setNewLine({ ...newLine, description: e.target.value })} />
            </div>
            <div>
              <label className="form-label">כמות</label>
              <input type="number" step="0.5" className="form-input" required value={newLine.quantity}
                onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })} />
            </div>
            <div>
              <label className="form-label">מחיר ליחידה</label>
              <input type="number" step="0.01" className="form-input" required value={newLine.unitPrice}
                onChange={(e) => setNewLine({ ...newLine, unitPrice: e.target.value })} />
            </div>
          </div>
          <div className="text-left">
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">הוסף</button>
          </div>
        </form>
      )}

      {isDraft && (
        <section className="bg-white rounded-xl border p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">הערות + הגדרות הפקה</h2>
          <div>
            <label className="form-label">הערות (יופיעו על המסמך)</label>
            <textarea className="form-input" rows={2} defaultValue={period.notes || ''}
              onBlur={(e) => e.target.value !== (period.notes || '') && updateNotesAndEmail({ notes: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={period.sendByEmail}
              onChange={(e) => updateNotesAndEmail({ sendByEmail: e.target.checked })} />
            שלח את המסמך אוטומטית במייל ללקוח לאחר ההפקה
            {period.sendByEmail && !order.contactEmail && (
              <span className="text-amber-600 mr-2">⚠️ אין מייל איש קשר</span>
            )}
          </label>
        </section>
      )}

      {isDraft && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button onClick={cancelDraft} disabled={busy}
            className="text-red-600 hover:text-red-800 px-4 py-2 rounded">בטל draft</button>
          <button onClick={preview} disabled={busy}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded inline-flex items-center gap-2 border">
            <Eye size={16} /> תצוגה מקדימה
          </button>
          <button onClick={issue} disabled={busy || missingTaxId || period.lines.length === 0}
            className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded inline-flex items-center gap-2 disabled:opacity-50"
            title={missingTaxId ? 'חסר ת.ז עוסק' : period.lines.length === 0 ? 'אין שורות' : ''}>
            <Send size={16} /> אשר והפק במורנינג
          </button>
        </div>
      )}
    </div>
  );
}
