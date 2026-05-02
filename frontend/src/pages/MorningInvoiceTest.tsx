import { useState } from 'react';
import { Plus, Trash2, FileText, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';
import PageHeader from '../components/ui/PageHeader';

const DOC_TYPES = [
  { value: 200, label: 'חשבון עסקה (Proforma)' },
  { value: 305, label: 'חשבונית מס' },
  { value: 320, label: 'חשבונית מס + קבלה' },
  { value: 400, label: 'קבלה' },
  { value: 10, label: 'הצעת מחיר' },
];

const VAT_TYPES = [
  { value: 1, label: 'הסכום לא כולל מע״מ — מורנינג מוסיפה 18%' },
  { value: 2, label: 'הסכום כולל מע״מ — מורנינג מפצלת לבד' },
  { value: 0, label: 'פטור ממע״מ' },
];

interface IncomeRow {
  description: string;
  quantity: number;
  price: number;
}

interface ResultDoc {
  id: string;
  number: number;
  type: number;
  documentDate: string;
  status: number;
  urlHe?: string;
  urlEn?: string;
  urlOrigin?: string;
}

export default function MorningInvoiceTest() {
  const [type, setType] = useState<number>(200);
  const [vatType, setVatType] = useState<number>(1);
  const [lang, setLang] = useState<'he' | 'en'>('he');
  const [client, setClient] = useState({
    name: '',
    taxId: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    addToMorning: true,
  });
  const [items, setItems] = useState<IncomeRow[]>([
    { description: '', quantity: 1, price: 0 },
  ]);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultDoc | null>(null);

  const total = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0);
  const vatLine = vatType === 1 ? Math.round(total * 0.18 * 100) / 100 : 0;
  const grandTotal = vatType === 1 ? total + vatLine : total;

  function addRow() {
    setItems([...items, { description: '', quantity: 1, price: 0 }]);
  }

  function removeRow(i: number) {
    if (items.length === 1) return;
    setItems(items.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, field: keyof IncomeRow, value: string | number) {
    setItems(items.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);

    try {
      const payload = {
        type,
        lang,
        currency: 'ILS',
        vatType,
        client: {
          name: client.name.trim(),
          taxId: client.taxId.trim() || undefined,
          emails: client.email ? [client.email.trim()] : undefined,
          phone: client.phone.trim() || undefined,
          address: client.address.trim() || undefined,
          city: client.city.trim() || undefined,
          add: client.addToMorning,
        },
        income: items.map((it) => ({
          description: it.description.trim(),
          quantity: Number(it.quantity),
          price: Number(it.price),
          vatType,
        })),
        remarks: remarks.trim() || undefined,
      };

      const { data } = await api.post('/morning/documents', payload);
      setResult(data.document);
    } catch (err: any) {
      const msg =
        err.response?.data?.details?.errorMessage ||
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'שגיאה לא ידועה';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <PageHeader
        title="הוצאת חשבון עסקה / מסמך מורנינג"
        subtitle="טופס בדיקה — מילוי ידני של פרטי לקוח ופריטים והפקה מיידית דרך ה-API של מורנינג"
        icon={FileText}
      />

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="text-green-600 mt-1" size={22} />
          <div className="flex-1">
            <h3 className="font-semibold text-green-900">המסמך הופק בהצלחה</h3>
            <p className="text-sm text-green-800 mt-1">
              מספר: <b>{result.number}</b> · סוג: {result.type} · תאריך: {result.documentDate.slice(0, 10)}
            </p>
            <div className="flex gap-3 mt-3 text-sm">
              {result.urlHe && (
                <a href={result.urlHe} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-green-700 hover:underline">
                  <ExternalLink size={14} /> PDF (עברית)
                </a>
              )}
              {result.urlOrigin && (
                <a href={result.urlOrigin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-green-700 hover:underline">
                  <ExternalLink size={14} /> מקור (חתום)
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="text-red-600 mt-1" size={22} />
          <div>
            <h3 className="font-semibold text-red-900">שגיאת מורנינג</h3>
            <p className="text-sm text-red-800 mt-1 whitespace-pre-wrap">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-6">
        <section className="bg-white rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">סוג מסמך</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="form-label">סוג</label>
              <select className="form-input" value={type} onChange={(e) => setType(Number(e.target.value))}>
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">שפה</label>
              <select className="form-input" value={lang} onChange={(e) => setLang(e.target.value as 'he' | 'en')}>
                <option value="he">עברית</option>
                <option value="en">English</option>
              </select>
            </div>
            <div>
              <label className="form-label">טיפול במע״מ</label>
              <select className="form-input" value={vatType} onChange={(e) => setVatType(Number(e.target.value))}>
                {VAT_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">פרטי לקוח</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="form-label">שם <span className="text-red-500">*</span></label>
              <input className="form-input" required value={client.name}
                     onChange={(e) => setClient({ ...client, name: e.target.value })} />
            </div>
            <div>
              <label className="form-label">ת.ז / ח.פ</label>
              <input className="form-input" value={client.taxId}
                     onChange={(e) => setClient({ ...client, taxId: e.target.value })}
                     placeholder="9 ספרות (ת.ז) או 9 ספרות (ח.פ)" />
            </div>
            <div>
              <label className="form-label">טלפון</label>
              <input className="form-input" value={client.phone}
                     onChange={(e) => setClient({ ...client, phone: e.target.value })} />
            </div>
            <div>
              <label className="form-label">אימייל</label>
              <input className="form-input" type="email" value={client.email}
                     onChange={(e) => setClient({ ...client, email: e.target.value })} />
            </div>
            <div>
              <label className="form-label">כתובת</label>
              <input className="form-input" value={client.address}
                     onChange={(e) => setClient({ ...client, address: e.target.value })} />
            </div>
            <div>
              <label className="form-label">עיר</label>
              <input className="form-input" value={client.city}
                     onChange={(e) => setClient({ ...client, city: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={client.addToMorning}
                   onChange={(e) => setClient({ ...client, addToMorning: e.target.checked })} />
            הוסף את הלקוח אוטומטית לרשימת הלקוחות במורנינג
          </label>
        </section>

        <section className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">פריטים</h2>
            <button type="button" onClick={addRow}
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800">
              <Plus size={16} /> הוסף שורה
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-600 border-b">
                <tr>
                  <th className="text-right p-2">תיאור</th>
                  <th className="text-right p-2 w-24">כמות</th>
                  <th className="text-right p-2 w-32">מחיר ליחידה (₪)</th>
                  <th className="text-right p-2 w-32">סכום שורה</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="p-2">
                      <input className="form-input" required value={row.description}
                             onChange={(e) => updateRow(i, 'description', e.target.value)} />
                    </td>
                    <td className="p-2">
                      <input className="form-input" type="number" min="0" step="0.5" value={row.quantity}
                             onChange={(e) => updateRow(i, 'quantity', Number(e.target.value))} />
                    </td>
                    <td className="p-2">
                      <input className="form-input" type="number" min="0" step="0.01" value={row.price}
                             onChange={(e) => updateRow(i, 'price', Number(e.target.value))} />
                    </td>
                    <td className="p-2 text-gray-700">
                      {(Number(row.quantity) * Number(row.price)).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}
                    </td>
                    <td className="p-2">
                      <button type="button" onClick={() => removeRow(i)}
                              disabled={items.length === 1}
                              className="text-red-600 hover:text-red-800 disabled:text-gray-300">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-gray-700 font-medium">
                <tr><td colSpan={3} className="p-2 text-left">סכום:</td>
                    <td className="p-2">{total.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</td><td/></tr>
                {vatType === 1 && (
                  <>
                    <tr><td colSpan={3} className="p-2 text-left">מע״מ 18%:</td>
                        <td className="p-2">{vatLine.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</td><td/></tr>
                    <tr className="text-base font-bold"><td colSpan={3} className="p-2 text-left">סה״כ לתשלום:</td>
                        <td className="p-2">{grandTotal.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</td><td/></tr>
                  </>
                )}
                {vatType !== 1 && (
                  <tr className="text-base font-bold"><td colSpan={3} className="p-2 text-left">סה״כ:</td>
                      <td className="p-2">{total.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</td><td/></tr>
                )}
              </tfoot>
            </table>
          </div>
        </section>

        <section className="bg-white rounded-xl border p-5">
          <label className="form-label">הערות (אופציונלי)</label>
          <textarea className="form-input" rows={3} value={remarks}
                    onChange={(e) => setRemarks(e.target.value)} placeholder="תיאור עסקה / הערות שיופיעו על המסמך" />
        </section>

        <div className="flex justify-end gap-3">
          <button type="submit" disabled={submitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-lg disabled:opacity-50">
            {submitting ? 'מפיק...' : 'הפק מסמך'}
          </button>
        </div>
      </form>
    </div>
  );
}
