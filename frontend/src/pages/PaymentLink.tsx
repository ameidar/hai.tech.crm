import { useEffect, useRef, useState } from 'react';
import {
  Copy, Check, ExternalLink, AlertCircle, Link2, User, X, FileText, CreditCard, Search, Sparkles,
} from 'lucide-react';
import { api } from '../api/client';
import PageHeader from '../components/ui/PageHeader';

interface GeneratedLink {
  url: string;            // long Morning URL
  shortUrl: string;       // short /pl/<code> URL
  code: string;
  description: string;
  amount: number;
  maxPayments: number;
  documentType: number;
  morningClientLinked: boolean;
}

interface CustomerLite {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

const DOC_TYPE_LABELS: Record<number, string> = {
  400: 'קבלה',
  320: 'חשבונית מס + קבלה',
  305: 'חשבונית מס',
};

export default function PaymentLink() {
  // form state
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [maxPayments, setMaxPayments] = useState<number>(1);
  const [documentType, setDocumentType] = useState<number>(400);
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);

  // customer picker state
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<CustomerLite[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedLink | null>(null);
  const [copied, setCopied] = useState<'short' | 'long' | null>(null);

  // close picker on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // debounced customer search
  useEffect(() => {
    if (customerId) return; // already selected
    const q = pickerQuery.trim();
    if (q.length < 2) { setPickerResults([]); return; }
    const t = setTimeout(async () => {
      setPickerLoading(true);
      try {
        const res = await api.get('/customers/lookup', { params: { q } });
        setPickerResults((res.data?.items as CustomerLite[]) || []);
      } catch {
        setPickerResults([]);
      } finally {
        setPickerLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [pickerQuery, customerId]);

  const pickCustomer = (c: CustomerLite) => {
    setCustomerId(c.id);
    setClientName(c.name);
    setClientPhone(c.phone || '');
    setClientEmail(c.email || '');
    setPickerOpen(false);
    setPickerQuery('');
  };

  const clearCustomer = () => {
    setCustomerId(null);
    setClientName('');
    setClientPhone('');
    setClientEmail('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setCopied(null);

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return setError('סכום חייב להיות מספר חיובי');
    if (!description.trim()) return setError('יש להזין תיאור לתשלום');
    const normalizedClientName = clientName.trim() || 'לקוח';

    setSubmitting(true);
    try {
      const res = await api.post('/payment-links', {
        description: description.trim(),
        amount: amt,
        maxPayments,
        documentType,
        customerId: customerId || undefined,
        client: {
          name: normalizedClientName,
          email: clientEmail.trim() || undefined,
          phone: clientPhone.trim() || undefined,
        },
      });
      setResult(res.data as GeneratedLink);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.response?.data?.error || err.message || 'יצירת הלינק נכשלה');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async (text: string, kind: 'short' | 'long') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  };

  const shareUrl = result?.shortUrl || result?.url || '';
  const waMessage = result
    ? `${clientName.trim() ? `שלום ${clientName.trim()}!\n\n` : ''}לינק לתשלום עבור: ${result.description}\nסכום: ₪${result.amount.toLocaleString('he-IL')}${result.maxPayments > 1 ? ` (עד ${result.maxPayments} תשלומים)` : ''}\n\n${shareUrl}`
    : '';
  const waUrl = result && clientPhone
    ? `https://wa.me/${clientPhone.replace(/\D/g, '').replace(/^0/, '972')}?text=${encodeURIComponent(waMessage)}`
    : null;

  const reset = () => {
    setResult(null);
    setError(null);
    setCopied(null);
    setDescription('');
    setAmount('');
    setMaxPayments(1);
    setDocumentType(400);
    clearCustomer();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="לינק לתשלום" subtitle="יצירת לינק תשלום במורנינג ושליחה ישירה ללקוח" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Customer picker */}
            <div ref={pickerRef} className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">לקוח קיים ב-CRM</label>
              {customerId ? (
                <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <User size={16} className="text-blue-700 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-blue-900 truncate">{clientName}</div>
                    {clientPhone && <div className="text-xs text-blue-700">{clientPhone}</div>}
                  </div>
                  <span className="text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded">מחובר לחשבונית ירוקה</span>
                  <button type="button" onClick={clearCustomer} className="text-blue-700 hover:text-blue-900" aria-label="נקה">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={pickerQuery}
                      onChange={(e) => { setPickerQuery(e.target.value); setPickerOpen(true); }}
                      onFocus={() => setPickerOpen(true)}
                      placeholder="חיפוש לפי שם, טלפון או אימייל"
                      className="w-full border border-gray-300 rounded-md pr-9 pl-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  {pickerOpen && (pickerQuery.trim().length >= 2 || pickerResults.length > 0) && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
                      {pickerLoading && <div className="p-3 text-xs text-gray-500">מחפש…</div>}
                      {!pickerLoading && pickerResults.length === 0 && (
                        <div className="p-3 text-xs text-gray-500">
                          לא נמצאו לקוחות — אפשר למלא את הפרטים ידנית למטה
                        </div>
                      )}
                      {pickerResults.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => pickCustomer(c)}
                          className="w-full text-right px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                        >
                          <div className="text-sm font-medium text-gray-900">{c.name}</div>
                          <div className="text-xs text-gray-500">{[c.phone, c.email].filter(Boolean).join(' · ')}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-gray-500">בחירה תקשר את הלינק ללקוח בחשבונית ירוקה (Morning)</p>
                </>
              )}
            </div>

            <hr className="border-gray-100" />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">תיאור התשלום *</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder='לדוגמה: שיעור ניסיון רובלוקס'
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                maxLength={300}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">סכום (₪) *</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">מספר תשלומים</label>
                <select
                  value={maxPayments}
                  onChange={(e) => setMaxPayments(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                    <option key={n} value={n}>{n === 1 ? 'תשלום אחד' : `עד ${n} תשלומים`}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                <FileText size={14} /> סוג מסמך
              </label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value={400}>קבלה</option>
                <option value={320}>חשבונית מס + קבלה</option>
                <option value={305}>חשבונית מס</option>
              </select>
            </div>

            <hr className="border-gray-100" />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">שם לקוח</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                disabled={!!customerId}
                placeholder="אופציונלי"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">אימייל</label>
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  disabled={!!customerId}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">טלפון</label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="0500000000"
                  disabled={!!customerId}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-600"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-l from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-md flex items-center justify-center gap-2 shadow-sm"
            >
              {submitting ? (
                <>יוצר לינק…</>
              ) : (
                <><Sparkles size={16} /> צור לינק תשלום</>
              )}
            </button>
          </form>
        </div>

        {/* Result */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {!result ? (
            <div className="text-center text-gray-400 py-16">
              <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
                <Link2 size={28} className="text-blue-400" />
              </div>
              <p className="text-sm">הלינק שייווצר יופיע כאן</p>
              <p className="text-xs text-gray-400 mt-1">מלא את הטופס ולחץ "צור לינק תשלום"</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <CreditCard size={18} className="text-blue-600" />
                    לינק התשלום מוכן
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">{result.description}</p>
                </div>
                <button
                  onClick={reset}
                  className="text-xs text-gray-500 hover:text-gray-700 underline whitespace-nowrap"
                >
                  לינק חדש
                </button>
              </div>

              {/* Short URL (primary) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-700">לינק לשליחה ללקוח</label>
                  {result.morningClientLinked && (
                    <span className="text-[10px] bg-green-100 text-green-800 px-2 py-0.5 rounded">מחובר לחשבונית ירוקה</span>
                  )}
                </div>
                <div className="flex items-center gap-2 p-3 bg-blue-50 border-2 border-blue-200 rounded-lg">
                  <input
                    type="text"
                    readOnly
                    value={result.shortUrl}
                    className="flex-1 bg-transparent border-0 outline-none text-base font-mono text-blue-900 truncate"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={() => handleCopy(result.shortUrl, 'short')}
                    className="flex-shrink-0 px-3 py-1.5 text-sm bg-white hover:bg-gray-50 border border-blue-300 text-blue-700 rounded flex items-center gap-1 font-medium"
                  >
                    {copied === 'short' ? (<><Check size={14} className="text-green-600" /> הועתק</>) : (<><Copy size={14} /> העתק</>)}
                  </button>
                </div>
              </div>

              {/* Long URL (collapsed) */}
              <details className="text-xs text-gray-500">
                <summary className="cursor-pointer hover:text-gray-700">הלינק הארוך של Morning</summary>
                <div className="flex items-center gap-2 mt-2 p-2 bg-gray-50 border border-gray-200 rounded">
                  <input
                    type="text"
                    readOnly
                    value={result.url}
                    className="flex-1 bg-transparent border-0 outline-none text-xs text-gray-600 truncate"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={() => handleCopy(result.url, 'long')}
                    className="flex-shrink-0 px-2 py-1 text-xs bg-white hover:bg-gray-100 border border-gray-300 rounded flex items-center gap-1"
                  >
                    {copied === 'long' ? (<Check size={12} className="text-green-600" />) : (<Copy size={12} />)}
                  </button>
                </div>
              </details>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 bg-gray-50 rounded">
                  <div className="text-xs text-gray-500">סכום</div>
                  <div className="font-semibold text-gray-900">
                    ₪{result.amount.toLocaleString('he-IL')}
                    {result.maxPayments > 1 && <span className="text-xs font-normal text-gray-500"> (עד {result.maxPayments} ת')</span>}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <div className="text-xs text-gray-500">סוג מסמך</div>
                  <div className="font-semibold text-gray-900">{DOC_TYPE_LABELS[result.documentType] || result.documentType}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href={result.shortUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md font-medium"
                >
                  <ExternalLink size={14} /> פתח לינק
                </a>
                {waUrl && (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md font-medium"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24z"/></svg>
                    שלח ב-WhatsApp ללקוח
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
