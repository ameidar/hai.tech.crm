import { useState, useEffect, useRef } from 'react';
import { CreditCard, Copy, Check, Send, X, RefreshCw, ExternalLink, Clock, FileText } from 'lucide-react';
import api from '../api/client';

interface Props {
  onClose: () => void;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  waConversationId?: string;
}

type Stage = 'form' | 'waiting' | 'paid';

interface Package {
  id: string;
  label: string;
  lessons: number | null;
  amount: number;
  description: string;
  maxInstallments: number;
}

const PACKAGES: Package[] = [
  { id: 'gold',    label: '🥇 גולד',    lessons: 16, amount: 2660, description: 'חבילת גולד — 16 שיעורים',    maxInstallments: 10 },
  { id: 'classic', label: '⭐ קלאסיק',  lessons: 24, amount: 3840, description: 'חבילת קלאסיק — 24 שיעורים', maxInstallments: 10 },
  { id: 'premium', label: '💎 פרימיום', lessons: 32, amount: 4992, description: 'חבילת פרימיום — 32 שיעורים', maxInstallments: 10 },
  { id: 'single',  label: '📚 שיעור',   lessons: 1,  amount: 175,  description: 'שיעור פרטני',                 maxInstallments: 1  },
  { id: 'custom',  label: '✏️ מותאם',   lessons: null, amount: 0,  description: '',                            maxInstallments: 10 },
];

export default function WooPayModal({ onClose, customerId, customerName = '', customerPhone = '', customerEmail = '', waConversationId }: Props) {
  const [stage, setStage] = useState<Stage>('form');
  const [selectedPkg, setSelectedPkg] = useState<Package | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [installments, setInstallments] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [directPaymentUrl, setDirectPaymentUrl] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [waSent, setWaSent] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isCustom = selectedPkg?.id === 'custom' || !selectedPkg;
  const maxInstallments = selectedPkg?.maxInstallments ?? 10;

  // When package selected — auto-fill amount + description
  const selectPackage = (pkg: Package) => {
    setSelectedPkg(pkg);
    setInstallments(1);
    setError('');
    if (pkg.id !== 'custom') {
      setAmount(String(pkg.amount));
      setDescription(pkg.description);
    } else {
      setAmount('');
      setDescription('');
    }
  };

  // Auto-poll every 10s while waiting
  useEffect(() => {
    if (stage !== 'waiting' || !orderId) return;
    const check = async () => {
      try {
        const r = await api.get(`/payments/order-status/${orderId}`);
        setPollCount(c => c + 1);
        if (r.data.paid) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (r.data.invoiceUrl) setInvoiceUrl(r.data.invoiceUrl);
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
        customerId: customerId || undefined,
        customerName, customerPhone, customerEmail,
        amount: Number(amount),
        description: description.trim(),
        installments: installments > 1 ? installments : undefined,
      });
      setPaymentUrl(r.data.paymentUrl);
      setDirectPaymentUrl(r.data.directPaymentUrl || r.data.paymentUrl);
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
      const installText = installments > 1 ? ` (${installments} תשלומים)` : '';
      await api.post('/wa/send', {
        conversationId: waConversationId,
        text: `💳 לינק לתשלום עבור "${description}"${installText}:\n${paymentUrl}`,
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
      if (r.data.paid) {
        if (r.data.invoiceUrl) setInvoiceUrl(r.data.invoiceUrl);
        setStage('paid');
      } else setError('התשלום טרם בוצע — המתן ולחץ שוב');
    } catch { setError('שגיאה בבדיקת סטטוס'); }
    finally { setCheckingStatus(false); }
  };

  const installmentAmount = installments > 1 && amount ? Math.ceil(Number(amount) / installments) : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">

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
          <div className="p-5 space-y-4">
            {customerName && (
              <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm">
                לקוח: <span className="font-medium">{customerName}</span>
                {customerPhone && <span className="text-gray-400"> · {customerPhone}</span>}
              </div>
            )}

            {/* Package Presets */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">בחר חבילה</label>
              <div className="grid grid-cols-5 gap-1.5">
                {PACKAGES.map(pkg => (
                  <button
                    key={pkg.id}
                    onClick={() => selectPackage(pkg)}
                    className={`flex flex-col items-center gap-0.5 px-2 py-2.5 rounded-xl border-2 text-xs font-medium transition-all ${
                      selectedPkg?.id === pkg.id
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 hover:border-purple-300 hover:bg-purple-50 text-gray-600'
                    }`}
                  >
                    <span className="text-base">{pkg.label.split(' ')[0]}</span>
                    <span className="text-center leading-tight">{pkg.label.split(' ').slice(1).join(' ')}</span>
                    {pkg.amount > 0 && <span className="text-purple-600 font-bold text-xs">₪{pkg.amount.toLocaleString()}</span>}
                    {pkg.lessons && <span className="text-gray-400 text-[10px]">{pkg.lessons} שיעורים</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">סכום לתשלום (₪) *</label>
              <input
                type="number" min="1"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="הכנס סכום"
                className={`input w-full ${!isCustom ? 'bg-gray-50' : ''}`}
                readOnly={!isCustom}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">תיאור *</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="שיעורי קוד — מחזור אביב 2026"
                className="input w-full"
                onKeyDown={e => e.key === 'Enter' && createLink()}
              />
            </div>

            {/* Installments */}
            {maxInstallments > 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  מספר תשלומים
                  {installmentAmount && <span className="text-purple-600 font-bold mr-2">≈ ₪{installmentAmount.toLocaleString()} / תשלום</span>}
                </label>
                <div className="flex gap-1.5 flex-wrap">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                    <button
                      key={n}
                      onClick={() => setInstallments(n)}
                      className={`w-10 h-10 rounded-lg border-2 text-sm font-medium transition-all ${
                        installments === n
                          ? 'border-purple-500 bg-purple-500 text-white'
                          : 'border-gray-200 hover:border-purple-300 text-gray-600'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="btn btn-secondary flex-1">ביטול</button>
              <button onClick={createLink} disabled={loading || !amount || !description} className="btn btn-primary flex-1">
                {loading ? <><RefreshCw size={14} className="animate-spin ml-1" />יוצר...</> : 'צור לינק תשלום'}
              </button>
            </div>
          </div>
        )}

        {/* ── Waiting for payment ── */}
        {stage === 'waiting' && paymentUrl && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <Clock size={20} className="text-yellow-600 flex-shrink-0 animate-pulse" />
              <div>
                <p className="font-medium text-yellow-800">ממתין לתשלום מהלקוח</p>
                <p className="text-xs text-yellow-600 mt-0.5">
                  בודק אוטומטית כל 10 שניות{pollCount > 0 ? ` · בדיקה ${pollCount}` : ''}
                </p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm space-y-1">
              {customerName && <p>👤 לקוח: <span className="font-medium">{customerName}</span></p>}
              <p>📋 תיאור: <span className="font-medium">{description}</span></p>
              <p>💰 סכום: <span className="font-bold text-purple-700">₪{Number(amount).toLocaleString()}</span>
                {installments > 1 && <span className="text-gray-500 text-xs mr-2">({installments} תשלומים · ≈₪{installmentAmount?.toLocaleString()} כל אחד)</span>}
              </p>
            </div>

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
            {invoiceUrl && (
              <a href={invoiceUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 bg-green-50 text-green-700 border border-green-200 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-green-100 transition-colors">
                <FileText size={16} />פתח חשבונית ירוקה
              </a>
            )}
            {!invoiceUrl && <p className="text-xs text-gray-400">החשבונית תישלח אוטומטית במייל ע"י Morning</p>}
            <button onClick={onClose} className="btn btn-primary w-full mt-2">סגור</button>
          </div>
        )}
      </div>
    </div>
  );
}
