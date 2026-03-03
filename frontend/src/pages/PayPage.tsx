import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || '/api';

interface PayInfo {
  id: string;
  customerName: string;
  description: string;
  amount: number;
  currency: string;
  maxInstallments: number | null;
  wooOrderId: number;
  status: string;
  alreadyPaid?: boolean;
}

export default function PayPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState(1);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/payments/pay-page/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setInfo(data);
        setChosen(1); // default: 1 payment
      })
      .catch(() => setError('שגיאה בטעינת פרטי התשלום'))
      .finally(() => setLoading(false));
  }, [token]);

  const handlePay = async () => {
    if (!token) return;
    setConfirming(true);
    try {
      const r = await fetch(`${API}/payments/pay-page/${token}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installments: chosen }),
      });
      const data = await r.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        setError(data.error || 'שגיאה בעיבוד הבקשה');
        setConfirming(false);
      }
    } catch {
      setError('שגיאה בשרת, נסה שוב');
      setConfirming(false);
    }
  };

  const perPayment = info && chosen > 1 ? Math.ceil(info.amount / chosen) : null;

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4"
      style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}
    >
      {/* Logo */}
      <div className="mb-6">
        <img src="/logo.png" alt="Hai.Tech" className="h-16 mx-auto" onError={e => (e.currentTarget.style.display = 'none')} />
        <div className="text-center mt-1 text-sm text-gray-400">דרך ההייטק בינה יוצרת מציאות</div>
      </div>

      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-6">
        {loading && (
          <div className="text-center py-10 text-gray-400">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mx-auto mb-3" />
            טוען...
          </div>
        )}

        {error && (
          <div className="text-center py-10 text-red-500">
            <div className="text-4xl mb-3">⚠️</div>
            <div className="font-medium">{error}</div>
          </div>
        )}

        {info?.alreadyPaid && (
          <div className="text-center py-10 text-green-600">
            <div className="text-5xl mb-3">✅</div>
            <div className="font-bold text-xl">התשלום כבר בוצע!</div>
            <div className="text-gray-500 mt-2">תודה, {info.customerName}</div>
          </div>
        )}

        {info && !info.alreadyPaid && (
          <>
            {/* Order summary */}
            <div className="border-b border-gray-100 pb-4 mb-4">
              <div className="flex justify-between text-sm text-gray-500 mb-1">
                <span>לקוח</span>
                <span className="font-medium text-gray-700">{info.customerName}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500 mb-1">
                <span>תיאור</span>
                <span className="font-medium text-gray-700 text-left max-w-[200px]">{info.description}</span>
              </div>
              <div className="flex justify-between text-lg font-bold mt-3">
                <span>סה"כ</span>
                <span className="text-blue-600">₪{info.amount.toLocaleString()}</span>
              </div>
            </div>

            {/* Installment picker */}
            {info.maxInstallments && info.maxInstallments > 1 ? (
              <div className="mb-5">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  בחר מספר תשלומים
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {Array.from({ length: info.maxInstallments }, (_, i) => i + 1).map(n => (
                    <button
                      key={n}
                      onClick={() => setChosen(n)}
                      className={`
                        py-2 rounded-lg border-2 text-sm font-bold transition-all
                        ${chosen === n
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-blue-300 text-gray-600'}
                      `}
                    >
                      {n === 1 ? 'חד' : n}
                    </button>
                  ))}
                </div>
                {chosen > 1 && perPayment && (
                  <div className="mt-3 text-center text-sm text-purple-600 font-medium">
                    ≈ ₪{perPayment.toLocaleString()} × {chosen} תשלומים
                  </div>
                )}
                {chosen === 1 && (
                  <div className="mt-3 text-center text-sm text-gray-400">תשלום מלא חד-פעמי</div>
                )}
              </div>
            ) : (
              <div className="mb-5 text-sm text-center text-gray-500">תשלום מלא</div>
            )}

            {/* Pay button */}
            <button
              onClick={handlePay}
              disabled={confirming}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-lg transition-colors shadow"
            >
              {confirming ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  מעבד...
                </span>
              ) : chosen > 1 ? (
                `לתשלום — ${chosen} תשלומים של ≈₪${perPayment?.toLocaleString()}`
              ) : (
                `לתשלום — ₪${info.amount.toLocaleString()}`
              )}
            </button>

            <div className="mt-4 text-center text-xs text-gray-400">
              🔒 תשלום מאובטח דרך מורנינג (GreenInvoice)
            </div>
          </>
        )}
      </div>
    </div>
  );
}
