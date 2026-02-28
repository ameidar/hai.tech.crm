import { useState } from 'react';
import { CreditCard, Copy, Check, Send, X } from 'lucide-react';
import api from '../api/client';

interface Props {
  onClose: () => void;
  // Pre-filled customer data
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  // If provided, "שלח ב-WhatsApp" will send the link to this conversation
  waConversationId?: string;
  waPhoneNumberId?: string;
}

export default function WooPayModal({
  onClose,
  customerName = '',
  customerPhone = '',
  customerEmail = '',
  waConversationId,
  waPhoneNumberId,
}: Props) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [waSent, setWaSent] = useState(false);
  const [error, setError] = useState('');

  const createLink = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setError('נא להזין סכום תקין');
      return;
    }
    if (!description.trim()) {
      setError('נא להזין תיאור');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const response = await api.post('/payments/create-link', {
        customerName,
        customerPhone,
        customerEmail,
        amount: Number(amount),
        description: description.trim(),
      });
      setPaymentUrl(response.data.paymentUrl);
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
      setError(e.response?.data?.error || e.message || 'שגיאה בשליחה ב-WhatsApp');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" dir="rtl">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <CreditCard size={20} className="text-blue-600" />
            <h2 className="text-lg font-semibold">יצירת לינק תשלום</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={18} />
          </button>
        </div>

        {!paymentUrl ? (
          /* ── Form ── */
          <div className="space-y-4">
            {customerName && (
              <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-700">
                לקוח: <span className="font-medium">{customerName}</span>
                {customerPhone && <span className="text-gray-400"> · {customerPhone}</span>}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                סכום לתשלום (₪) *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500"
                className="input w-full"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                תיאור *
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="שיעורי קוד — מחזור אביב 2026"
                className="input w-full"
                onKeyDown={(e) => e.key === 'Enter' && createLink()}
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="btn btn-secondary flex-1">
                ביטול
              </button>
              <button onClick={createLink} disabled={loading} className="btn btn-primary flex-1">
                {loading ? 'יוצר לינק...' : 'יצירת לינק תשלום'}
              </button>
            </div>
          </div>
        ) : (
          /* ── Link Result ── */
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-sm font-medium text-green-700 mb-1">✅ לינק נוצר בהצלחה!</p>
              <p className="text-xs text-green-600">{description} — ₪{Number(amount).toLocaleString()}</p>
            </div>

            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
              <a
                href={paymentUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 underline flex-1 truncate"
                dir="ltr"
              >
                {paymentUrl}
              </a>
              <button
                onClick={copyLink}
                className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded px-2 py-1 shrink-0"
              >
                {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                {copied ? 'הועתק!' : 'העתק'}
              </button>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3">
              {waConversationId && (
                <button
                  onClick={sendViaWhatsApp}
                  disabled={waSent}
                  className="btn btn-primary flex-1 flex items-center gap-2 justify-center"
                >
                  {waSent ? (
                    <>
                      <Check size={16} />
                      נשלח ב-WhatsApp!
                    </>
                  ) : (
                    <>
                      <Send size={16} />
                      שלח ב-WhatsApp
                    </>
                  )}
                </button>
              )}
              <button onClick={onClose} className="btn btn-secondary flex-1">
                סגור
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
