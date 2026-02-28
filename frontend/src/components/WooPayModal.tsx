import { useState, useEffect, useRef } from 'react';
import { CreditCard, Copy, Check, Send, X, RefreshCw, ExternalLink } from 'lucide-react';
import api from '../api/client';

interface Props {
  onClose: () => void;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  waConversationId?: string;
  waPhoneNumberId?: string;
}

type Stage = 'form' | 'payment' | 'paid';

export default function WooPayModal({
  onClose,
  customerName = '',
  customerPhone = '',
  customerEmail = '',
  waConversationId,
  waPhoneNumberId,
}: Props) {
  const [stage, setStage] = useState<Stage>('form');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Payment stage
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [waSent, setWaSent] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll order status every 10s once in payment stage
  useEffect(() => {
    if (stage !== 'payment' || !orderId) return;

    const checkStatus = async () => {
      try {
        const r = await api.get(`/payments/order-status/${orderId}`);
        if (r.data.paid) {
          if (pollRef.current) clearInterval(pollRef.current);
          setStage('paid');
        }
      } catch {}
    };

    pollRef.current = setInterval(checkStatus, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [stage, orderId]);

  const createLink = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return setError('נא להזין סכום תקין');
    if (!description.trim()) return setError('נא להזין תיאור');
    setError('');
    setLoading(true);
    try {
      const r = await api.post('/payments/create-link', {
        customerName, customerPhone, customerEmail,
        amount: Number(amount),
        description: description.trim(),
      });
      setPaymentUrl(r.data.paymentUrl);
      setOrderId(r.data.orderId);
      setStage('payment');
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'שגיאה ביצירת הלינק');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    if (!paymentUrl) return;
    await navigator.clipboard.writeText(paymentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendViaWhatsApp = async () => {
    if (!paymentUrl || !waConversationId) return;
    try {
      await api.post('/wa/send', {
        conversationId: waConversationId,
        text: `💳 לינק לתשלום עבור "${description}":\n${paymentUrl}`,
      });
      setWaSent(true);
    } catch (e: any) {
      setError(e.response?.data?.error || 'שגיאה בשליחה ב-WhatsApp');
    }
  };

  const checkStatusNow = async () => {
    if (!orderId) return;
    setCheckingStatus(true);
    try {
      const r = await api.get(`/payments/order-status/${orderId}`);
      if (r.data.paid) setStage('paid');
      else setError('התשלום טרם בוצע');
    } catch {
      setError('שגיאה בבדיקת סטטוס');
    } finally {
      setCheckingStatus(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" dir="rtl">
      <div className={`bg-white rounded-xl shadow-2xl flex flex-col ${stage === 'payment' ? 'w-full max-w-3xl h-[90vh]' : 'w-full max-w-md'}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <CreditCard size={20} className="text-purple-600" />
            <h2 className="text-lg font-semibold">
              {stage === 'form' && 'יצירת לינק תשלום'}
              {stage === 'payment' && `💳 תשלום — ₪${Number(amount).toLocaleString()}`}
              {stage === 'paid' && '✅ תשלום אושר!'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={18} />
          </button>
        </div>

        {/* ── Form Stage ── */}
        {stage === 'form' && (
          <div className="p-6 space-y-4">
            {customerName && (
              <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-700">
                לקוח: <span className="font-medium">{customerName}</span>
                {customerPhone && <span className="text-gray-400"> · {customerPhone}</span>}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">סכום לתשלום (₪) *</label>
              <input type="number" min="1" step="1" value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="500" className="input w-full" autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">תיאור *</label>
              <input type="text" value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="שיעורי קוד — מחזור אביב 2026" className="input w-full"
                onKeyDown={e => e.key === 'Enter' && createLink()} />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="btn btn-secondary flex-1">ביטול</button>
              <button onClick={createLink} disabled={loading} className="btn btn-primary flex-1">
                {loading ? <><RefreshCw size={14} className="animate-spin" /> יוצר...</> : 'צור לינק תשלום'}
              </button>
            </div>
          </div>
        )}

        {/* ── Payment Stage ── */}
        {stage === 'payment' && paymentUrl && (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Action bar */}
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0 flex-wrap">
              <button onClick={copyLink}
                className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                {copied ? 'הועתק!' : 'העתק לינק'}
              </button>
              {waConversationId && (
                <button onClick={sendViaWhatsApp} disabled={waSent}
                  className="flex items-center gap-1.5 text-xs bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-lg px-3 py-1.5">
                  {waSent ? <><Check size={12} /> נשלח!</> : <><Send size={12} /> שלח ב-WhatsApp</>}
                </button>
              )}
              <a href={paymentUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                <ExternalLink size={12} /> פתח בטאב
              </a>
              <div className="flex-1" />
              <button onClick={checkStatusNow} disabled={checkingStatus}
                className="flex items-center gap-1.5 text-xs text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg px-3 py-1.5">
                {checkingStatus ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                בדוק סטטוס
              </button>
            </div>

            {/* iframe */}
            {!iframeError ? (
              <iframe
                src={paymentUrl}
                className="flex-1 w-full border-0"
                title="דף תשלום"
                onError={() => setIframeError(true)}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
                <CreditCard size={48} className="text-gray-300" />
                <p className="text-gray-600">לא ניתן להציג את דף התשלום ישירות.</p>
                <a href={paymentUrl} target="_blank" rel="noreferrer" className="btn btn-primary">
                  <ExternalLink size={16} /> פתח דף תשלום
                </a>
              </div>
            )}

            {error && (
              <div className="px-4 py-2 bg-red-50 border-t border-red-100 text-sm text-red-600 flex-shrink-0">{error}</div>
            )}
          </div>
        )}

        {/* ── Paid Stage ── */}
        {stage === 'paid' && (
          <div className="p-8 text-center space-y-4">
            <div className="text-5xl">🎉</div>
            <h3 className="text-xl font-bold text-green-700">התשלום התקבל!</h3>
            <p className="text-gray-600">{description} — ₪{Number(amount).toLocaleString()}</p>
            {customerName && <p className="text-sm text-gray-500">לקוח: {customerName}</p>}
            <button onClick={onClose} className="btn btn-primary w-full mt-4">סגור</button>
          </div>
        )}
      </div>
    </div>
  );
}
