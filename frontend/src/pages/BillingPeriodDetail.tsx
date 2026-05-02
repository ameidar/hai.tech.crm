import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight, Plus, Trash2, Eye, Send, AlertCircle, CheckCircle2, ExternalLink, X, MessageCircle, Wallet, FileCheck2 } from 'lucide-react';
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

interface Payment {
  id: string;
  amount: string | number;
  method: string | null;
  notes: string | null;
  paidAt: string;
  recordedById: string | null;
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
  dueDate: string | null;
  taxInvoiceId: string | null;
  taxInvoiceNumber: number | null;
  taxInvoiceUrl: string | null;
  taxInvoiceIssuedAt: string | null;
  sentAt: string | null;
  sentChannel: string | null;
  sentToEmail: string | null;
  sentToPhone: string | null;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  paidAmount: string | number;
  paidAt: string | null;
  institutionalOrder: {
    id: string;
    orderName: string | null;
    taxId: string | null;
    contactEmail: string | null;
    contactName: string | null;
    contactPhone?: string | null;
    address: string | null;
    city: string | null;
    branch?: { name: string | null };
  };
  lines: Line[];
  payments: Payment[];
  _count?: { meetings: number };
}

interface DriftMeeting {
  id: string;
  scheduledDate: string;
  startTime: string;
  revenue: string | number;
  instructorPayment: string | number;
  cycle: { id: string; name: string; type: string };
  instructor: { id: string; name: string };
}

interface DriftReport {
  issuedAt: string | null;
  snapshotCount: number;
  currentCount: number;
  newSinceIssue: DriftMeeting[];
  removedSinceIssue: string[];
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

  // Payment + actions state
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [newPayment, setNewPayment] = useState({ amount: '', method: '', notes: '', paidAt: new Date().toISOString().slice(0, 10) });
  const [showWhatsAppForm, setShowWhatsAppForm] = useState(false);
  const [waPhone, setWaPhone] = useState('');
  const [waMessage, setWaMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/billing/${id}`);
      setPeriod(data);
      if (data.status === 'issued') {
        try {
          const { data: d } = await api.get(`/billing/${id}/drift`);
          setDrift(d);
        } catch { setDrift(null); }
      } else {
        setDrift(null);
      }
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

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/billing/${id}/payments`, {
        amount: Number(newPayment.amount),
        method: newPayment.method || null,
        notes: newPayment.notes || null,
        paidAt: newPayment.paidAt || null,
      });
      setNewPayment({ amount: '', method: '', notes: '', paidAt: new Date().toISOString().slice(0, 10) });
      setShowPaymentForm(false);
      await load();
    } catch (err) { handleErr(err); } finally { setBusy(false); }
  }

  async function deletePayment(paymentId: string) {
    if (!confirm('למחוק את רישום התשלום?')) return;
    setError(null);
    try {
      await api.delete(`/billing/${id}/payments/${paymentId}`);
      await load();
    } catch (err) { handleErr(err); }
  }

  async function markSent(channel: 'manual' | 'email') {
    setError(null);
    try {
      await api.post(`/billing/${id}/mark-sent`, {
        channel,
        toEmail: channel === 'email' ? period?.institutionalOrder.contactEmail || null : null,
      });
      await load();
    } catch (err) { handleErr(err); }
  }

  async function openWhatsApp() {
    if (!period) return;
    const phone = period.institutionalOrder.contactPhone || '';
    setWaPhone(phone);
    const orderName = period.institutionalOrder.orderName || 'מוסד';
    const monthDate = new Date(period.month);
    const monthLbl = `${HEBREW_MONTHS[monthDate.getUTCMonth()]} ${monthDate.getUTCFullYear()}`;
    const totalGross = (Number(period.totalAmount) * 1.18).toFixed(2);
    setWaMessage([
      `שלום,`,
      `מצורף חשבון עסקה מספר ${period.morningDocNumber} עבור ${orderName} — ${monthLbl}.`,
      `סכום לתשלום: ₪${totalGross} (כולל מע"מ).`,
      `קישור למסמך: ${period.morningDocUrl}`,
      ``,
      `דרך ההיי-טק בע"מ`,
    ].join('\n'));
    setShowWhatsAppForm(true);
  }

  async function sendWhatsApp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/billing/${id}/send-whatsapp`, {
        phone: waPhone,
        message: waMessage,
      });
      setShowWhatsAppForm(false);
      await load();
    } catch (err) { handleErr(err); } finally { setBusy(false); }
  }

  async function issueTaxInvoice() {
    if (!confirm('להפיק חשבונית מס מחייבת (305) במורנינג? המסמך לא ניתן לביטול.')) return;
    setError(null);
    setBusy(true);
    try {
      await api.post(`/billing/${id}/issue-tax-invoice`);
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
            <h3 className="font-semibold text-green-900">חשבון עסקה הופק במורנינג</h3>
            <p className="text-sm text-green-800 mt-1">
              מספר: <b>{period.morningDocNumber}</b>
              {period.issuedAt && <> · הופק: {new Date(period.issuedAt).toLocaleString('he-IL')}</>}
              {period.dueDate && <> · לתשלום עד: {new Date(period.dueDate).toLocaleDateString('he-IL')}</>}
            </p>
            <div className="flex flex-wrap gap-3 mt-2 text-sm">
              {period.morningDocUrl && (
                <a href={period.morningDocUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-green-700 hover:underline">
                  <ExternalLink size={14} /> חשבון עסקה (PDF)
                </a>
              )}
              {period.taxInvoiceUrl && (
                <a href={period.taxInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-green-700 hover:underline">
                  <ExternalLink size={14} /> חשבונית מס #{period.taxInvoiceNumber} (PDF)
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {drift && (drift.newSinceIssue.length > 0 || drift.removedSinceIssue.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5" />
            <div className="flex-1">
              <b>שינוי בפגישות אחרי ההפקה</b> — בעת ההפקה נכללו {drift.snapshotCount} פגישות, ועכשיו יש {drift.currentCount}.
              {drift.newSinceIssue.length > 0 && (
                <div className="mt-2">
                  <b>{drift.newSinceIssue.length} פגישות חדשות שלא חויבו:</b>
                  <ul className="mt-1 list-disc pr-5 space-y-0.5">
                    {drift.newSinceIssue.map((m) => (
                      <li key={m.id}>
                        {new Date(m.scheduledDate).toLocaleDateString('he-IL')} · {m.cycle.name} · {m.instructor.name}
                        {Number(m.instructorPayment) > 0 && (
                          <span className="text-red-700 mx-1">⚠️ שולם למדריך {Number(m.instructorPayment).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs mt-2">שקול ליצור חשבון משלים לחודש הבא או לעדכן את החשבון הקיים ידנית במורנינג.</p>
                </div>
              )}
              {drift.removedSinceIssue.length > 0 && (
                <div className="mt-2">
                  <b>{drift.removedSinceIssue.length} פגישות שכבר לא רלוונטיות</b> (נמחקו / שונה סטטוס לאחר ההפקה).
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {missingTaxId && isDraft && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <div>
            <b>חסר ת.ז עוסק / ח.פ</b> — ניתן להפיק גם בלי, אבל מומלץ למלא דרך
            <Link to={`/institutional-orders`} className="underline mx-1">עמוד המוסד</Link>
            לזיהוי מלא של הלקוח אצל מורנינג.
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
          <button onClick={issue} disabled={busy || period.lines.length === 0}
            className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded inline-flex items-center gap-2 disabled:opacity-50"
            title={period.lines.length === 0 ? 'אין שורות' : ''}>
            <Send size={16} /> אשר והפק במורנינג
          </button>
        </div>
      )}

      {/* ── Payment tracking ─────────────────────────────────────────── */}
      {period.status === 'issued' && (
        <section className="bg-white rounded-xl border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet size={18} className="text-gray-600" />
              <h2 className="font-semibold text-gray-900">מעקב תשלומים</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                period.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' :
                period.paymentStatus === 'partial' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>
                {period.paymentStatus === 'paid' ? 'שולם' :
                 period.paymentStatus === 'partial' ? 'שולם חלקית' : 'טרם שולם'}
              </span>
            </div>
            {!showPaymentForm && period.paymentStatus !== 'paid' && (
              <button onClick={() => setShowPaymentForm(true)}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded inline-flex items-center gap-1">
                <Plus size={14} /> הוסף תשלום
              </button>
            )}
          </div>

          <div className="text-sm text-gray-600">
            שולם: <b>{Number(period.paidAmount).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</b>
            {' '}מתוך{' '}
            <b>{(Number(period.totalAmount) * 1.18).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</b>
            {' '}(כולל מע"מ)
            {Number(period.paidAmount) > 0 && Number(period.paidAmount) < Number(period.totalAmount) * 1.18 && (
              <span className="text-amber-700 mr-2">
                · יתרה: {((Number(period.totalAmount) * 1.18) - Number(period.paidAmount)).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}
              </span>
            )}
          </div>

          {period.payments.length > 0 && (
            <table className="w-full text-sm border rounded overflow-hidden">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-right p-2">תאריך</th>
                  <th className="text-right p-2">סכום</th>
                  <th className="text-right p-2">אמצעי תשלום</th>
                  <th className="text-right p-2">הערות</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {period.payments.map((pay) => (
                  <tr key={pay.id} className="border-t">
                    <td className="p-2">{new Date(pay.paidAt).toLocaleDateString('he-IL')}</td>
                    <td className="p-2 font-medium">{Number(pay.amount).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</td>
                    <td className="p-2">{pay.method || '—'}</td>
                    <td className="p-2 text-gray-500">{pay.notes || '—'}</td>
                    <td className="p-2">
                      <button onClick={() => deletePayment(pay.id)} className="text-red-500 hover:text-red-700">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {showPaymentForm && (
            <form onSubmit={addPayment} className="bg-gray-50 rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm">תשלום חדש</h3>
                <button type="button" onClick={() => setShowPaymentForm(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">סכום (₪)</label>
                  <input type="number" step="0.01" className="form-input" required value={newPayment.amount}
                    onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">תאריך תשלום</label>
                  <input type="date" className="form-input" value={newPayment.paidAt}
                    onChange={(e) => setNewPayment({ ...newPayment, paidAt: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">אמצעי תשלום</label>
                  <input className="form-input" placeholder="העברה / צ׳ק / מזומן…" value={newPayment.method}
                    onChange={(e) => setNewPayment({ ...newPayment, method: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">הערות</label>
                  <input className="form-input" value={newPayment.notes}
                    onChange={(e) => setNewPayment({ ...newPayment, notes: e.target.value })} />
                </div>
              </div>
              <div className="text-left">
                <button type="submit" disabled={busy} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                  שמור תשלום
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* ── Send + tax invoice actions ────────────────────────────────── */}
      {period.status === 'issued' && (
        <section className="bg-white rounded-xl border p-5 space-y-4">
          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-gray-600" />
            <h2 className="font-semibold text-gray-900">שליחה ותיעוד</h2>
            {period.sentAt && (
              <span className="text-xs text-gray-500">
                · נשלח: {new Date(period.sentAt).toLocaleString('he-IL')} דרך {period.sentChannel}
                {period.sentToPhone && ` → ${period.sentToPhone}`}
                {period.sentToEmail && ` → ${period.sentToEmail}`}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={openWhatsApp} disabled={!period.morningDocUrl}
              className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-sm disabled:opacity-40"
              title={!period.morningDocUrl ? 'אין קישור מסמך' : ''}>
              <MessageCircle size={15} /> שלח בWhatsApp
            </button>

            <button onClick={() => markSent('manual')}
              className="inline-flex items-center gap-2 bg-gray-100 hover:bg-gray-200 border text-gray-700 px-4 py-2 rounded text-sm">
              <CheckCircle2 size={15} /> סמן כנשלח (ידני)
            </button>

            {!period.taxInvoiceId && (
              <button onClick={issueTaxInvoice} disabled={busy}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                <FileCheck2 size={15} /> הפק חשבונית מס (305)
              </button>
            )}
            {period.taxInvoiceId && period.taxInvoiceUrl && (
              <a href={period.taxInvoiceUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 border text-indigo-700 hover:bg-indigo-50 px-4 py-2 rounded text-sm">
                <FileCheck2 size={15} /> חשבונית מס #{period.taxInvoiceNumber}
              </a>
            )}
          </div>

          {showWhatsAppForm && (
            <form onSubmit={sendWhatsApp} className="bg-gray-50 rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm">שליחת WhatsApp</h3>
                <button type="button" onClick={() => setShowWhatsAppForm(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <div>
                <label className="form-label">מספר טלפון (כולל קידומת בינ"ל)</label>
                <input className="form-input" dir="ltr" placeholder="972501234567" required value={waPhone}
                  onChange={(e) => setWaPhone(e.target.value)} />
              </div>
              <div>
                <label className="form-label">תוכן ההודעה</label>
                <textarea className="form-input" rows={6} value={waMessage}
                  onChange={(e) => setWaMessage(e.target.value)} />
              </div>
              <div className="text-left">
                <button type="submit" disabled={busy || !waPhone}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                  שלח
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
