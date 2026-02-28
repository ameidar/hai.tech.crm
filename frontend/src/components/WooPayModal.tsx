import { useState, useEffect, useRef } from 'react';
import { CreditCard, Copy, Check, Send, X, RefreshCw, ExternalLink, Clock } from 'lucide-react';
import api from '../api/client';

interface Props {
  onClose: () => void;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  waConversationId?: string;
}

type Stage = 'form' | 'waiting' | 'paid';

export default function WooPayModal({ onClose, customerName = '', customerPhone = '', customerEmail = '', waConversationId }: Props) {
  const [stage, setStage] = useState<Stage>('form');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [waSent, setWaSent] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-poll every 10s while waiting
  useEffect(() => {
    if (stage !== 'waiting' || !orderId) return;
    const check = async () => {
      try {
        const r = await api.get(`/payments/order-status/${orderId}`);
        setPollCount(c => c + 1);
        if (r.data.paid) {
          if (pollRef.current) clearInterval(pollRef.current);
          setStage('paid');
        }
      } catch {}
    };
    pollRef.current = setInterval(check, 10000);
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
        amount: Number(amount), description: description.trim(),
      });
      setPaymentUrl(r.data.paymentUrl);
      setOrderId(r.data.orderId);
      setStage('waiting');
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'שגיאה ביצירת הלינק');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    if (!paymentUrl) return;
    await navigator.clipboard.writeText(paymentUrl);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
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
      setError(e.response?.data?.error || 'שגיאה בשליחה');
    }
  };

  const checkNow = async () => {
    if (!orderId) return;
    setCheckingStatus(true);
    setError('');
    try {
      const r = await api.get(`/payments/order-status/${orderId}`);
      if (r.data.paid) setStage('paid');
      else setError('התשלום טרם בוצע — המתן ולחץ שוב');
    } catch { setError('שגיאה בבדיקת סטטוס'); }
    finally { setCheckingStatus(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <CreditCard size={20} className="text-purple-600" />
            <h2 className="text-lg font-semibold">
              {stage === 'form' && 'יצירת לינק תשלום'}
              {stage === 'waiting' && `💳 ממתין לתשלום — ₪${Number(amount).toLocaleString()}`}
              {stage === 'paid' && '✅ תשלום אושר!'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>

        {/* ── Form ── */}
        {stage === 'form' && (
          <div className="p-6 space-y-4">
            {customerName && (
              <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm">
                לקוח: <span className="font-medium">{customerName}</span>
                {customerPhone && <span className="text-gray-400"> · {customerPhone}</span>}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">סכום לתשלום (₪) *</label>
              <input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="500" className="input w-full" autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">תיאור *</label>
              <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="שיעורי קוד — מחזור אביב 2026" className="input w-full"
                onKeyDown={e => e.key === 'Enter' && createLink()} />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="btn btn-secondary flex-1">ביטול</button>
              <button onClick={createLink} disabled={loading} className="btn btn-primary flex-1">
                {loading ? <><RefreshCw size={14} className="animate-spin ml-1" />יוצר...</> : 'צור לינק תשלום'}
              </button>
            </div>
          </div>
        )}

        {/* ── Waiting for payment ── */}
        {stage === 'waiting' && paymentUrl && (
          <div className="p-6 space-y-5">
            {/* Status indicator */}
            <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <Clock size={20} className="text-yellow-600 flex-shrink-0 animate-pulse" />
              <div>
                <p className="font-medium text-yellow-800">ממתין לתשלום מהלקוח</p>
                <p className="text-xs text-yellow-600 mt-0.5">
                  בודק אוטומטית כל 10 שניות{pollCount > 0 ? ` · בדיקה ${pollCount}` : ''}
                </p>
              </div>
            </div>

            {/* Customer + amount summary */}
            <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm space-y-1">
              {customerName && <p>👤 לקוח: <span className="font-medium">{customerName}</span></p>}
              <p>📋 תיאור: <span className="font-medium">{description}</span></p>
              <p>💰 סכום: <span className="font-bold text-purple-700">₪{Number(amount).toLocaleString()}</span></p>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              {waConversationId && (
                <button onClick={sendViaWhatsApp} disabled={waSent}
                  className="w-full flex items-center justify-center gap-2 btn bg-green-500 hover:bg-green-600 disabled:bg-green-200 text-white">
                  {waSent ? <><Check size={16} />הלינק נשלח ב-WhatsApp!</> : <><Send size={16} />שלח לינק תשלום ב-WhatsApp</>}
                </button>
              )}

              <div className="flex gap-2">
                <button onClick={copyLink}
                  className="flex-1 flex items-center justify-center gap-1.5 btn btn-secondary text-sm">
                  {copied ? <><Check size={14} className="text-green-600" />הועתק!</> : <><Copy size={14} />העתק לינק</>}
                </button>
                <a href={paymentUrl} target="_blank" rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 btn btn-secondary text-sm">
                  <ExternalLink size={14} />פתח בטאב
                </a>
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            {/* Manual check */}
            <button onClick={checkNow} disabled={checkingStatus}
              className="w-full flex items-center justify-center gap-2 text-sm text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg px-4 py-2.5 transition-colors">
              {checkingStatus ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              בדוק אם התשלום בוצע עכשיו
            </button>
          </div>
        )}

        {/* ── Paid ── */}
        {stage === 'paid' && (
          <div className="p-8 text-center space-y-4">
            <div className="text-5xl">🎉</div>
            <h3 className="text-xl font-bold text-green-700">התשלום התקבל!</h3>
            <p className="text-gray-600">{description}</p>
            <p className="text-2xl font-bold text-green-600">₪{Number(amount).toLocaleString()}</p>
            {customerName && <p className="text-sm text-gray-500">מאת: {customerName}</p>}
            <button onClick={onClose} className="btn btn-primary w-full mt-2">סגור</button>
          </div>
        )}
      </div>
    </div>
  );
}
