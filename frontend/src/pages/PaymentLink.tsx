import { useState } from 'react';
import { Copy, Check, ExternalLink, AlertCircle, Link2 } from 'lucide-react';
import { api } from '../api/client';
import PageHeader from '../components/ui/PageHeader';

interface GeneratedLink {
  url: string;
  description: string;
  amount: number;
  maxPayments: number;
}

export default function PaymentLink() {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [maxPayments, setMaxPayments] = useState<number>(1);
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedLink | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setCopied(false);

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('סכום חייב להיות מספר חיובי');
      return;
    }
    if (!description.trim()) { setError('יש להזין תיאור לתשלום'); return; }
    if (!clientName.trim()) { setError('יש להזין שם לקוח'); return; }

    setSubmitting(true);
    try {
      const res = await api.post('/payment-links', {
        description: description.trim(),
        amount: amt,
        maxPayments,
        client: {
          name: clientName.trim(),
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

  const handleCopy = async () => {
    if (!result?.url) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // older browsers — fall back to selection
      const ta = document.createElement('textarea');
      ta.value = result.url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const waMessage = result
    ? `שלום ${clientName}!\n\nלינק לתשלום עבור: ${result.description}\nסכום: ₪${result.amount.toLocaleString('he-IL')}${result.maxPayments > 1 ? ` (עד ${result.maxPayments} תשלומים)` : ''}\n\n${result.url}`
    : '';

  const waUrl = result && clientPhone
    ? `https://wa.me/${clientPhone.replace(/\D/g, '').replace(/^0/, '972')}?text=${encodeURIComponent(waMessage)}`
    : null;

  const reset = () => {
    setResult(null);
    setError(null);
    setCopied(false);
    setDescription('');
    setAmount('');
    setMaxPayments(1);
    setClientName('');
    setClientEmail('');
    setClientPhone('');
  };

  return (
    <div className="space-y-6">
      <PageHeader title="לינק לתשלום" subtitle="יצירת לינק תשלום במורנינג ושליחה ישירה ללקוח" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="bg-white rounded-lg shadow p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">תיאור התשלום *</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder='לדוגמה: שיעור ניסיון רובלוקס'
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
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
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">מספר תשלומים</label>
                <select
                  value={maxPayments}
                  onChange={(e) => setMaxPayments(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                    <option key={n} value={n}>{n === 1 ? 'תשלום אחד' : `עד ${n} תשלומים`}</option>
                  ))}
                </select>
              </div>
            </div>

            <hr className="my-2" />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">שם לקוח *</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">אימייל</label>
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">טלפון</label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="0500000000"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
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
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2 px-4 rounded-md flex items-center justify-center gap-2"
            >
              {submitting ? 'יוצר לינק…' : (<><Link2 size={16} /> צור לינק תשלום</>)}
            </button>
          </form>
        </div>

        {/* Result */}
        <div className="bg-white rounded-lg shadow p-6">
          {!result ? (
            <div className="text-center text-gray-400 py-12">
              <Link2 size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">הלינק שייווצר יופיע כאן</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-gray-900">לינק התשלום</h3>
                  <p className="text-sm text-gray-500">{result.description}</p>
                </div>
                <button
                  onClick={reset}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  לינק חדש
                </button>
              </div>

              <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-md">
                <input
                  type="text"
                  readOnly
                  value={result.url}
                  className="flex-1 bg-transparent border-0 outline-none text-sm text-gray-700 truncate"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={handleCopy}
                  className="flex-shrink-0 px-3 py-1 text-sm bg-white hover:bg-gray-100 border border-gray-300 rounded flex items-center gap-1"
                >
                  {copied ? (<><Check size={14} className="text-green-600" /> הועתק</>) : (<><Copy size={14} /> העתק</>)}
                </button>
              </div>

              <div className="text-sm text-gray-600">
                <strong>סכום:</strong> ₪{result.amount.toLocaleString('he-IL')}{result.maxPayments > 1 && ` (עד ${result.maxPayments} תשלומים)`}
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                >
                  <ExternalLink size={14} /> פתח לינק
                </a>
                {waUrl && (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded"
                  >
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
