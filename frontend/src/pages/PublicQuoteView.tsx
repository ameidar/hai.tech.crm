import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';

interface QuoteItem {
  id: string;
  courseName: string;
  groups: number;
  meetingsPerGroup: number;
  durationMinutes: number;
  pricePerMeeting: number;
  subtotal: number;
  description?: string;
}

interface PublicQuote {
  id: string;
  quoteNumber: string;
  institutionName: string;
  contactName: string;
  contactPhone?: string;
  contactEmail?: string;
  items: QuoteItem[];
  discount: number;
  totalAmount: number;
  finalAmount?: number;
  includesVat?: boolean;
  cancellationTerms?: string;
  paymentTerms?: string;
  generatedContent?: string;
  content?: string;
  notes?: string;
  status: string;
  videoPath?: string;
  createdAt: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function PublicQuoteView() {
  const { id } = useParams<{ id: string }>();
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [vimeoUrl, setVimeoUrl] = useState<string | null>(null);

  // Client response state
  const [clientNotes, setClientNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [responseStatus, setResponseStatus] = useState<'accepted' | 'rejected' | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    axios
      .get(`${API_BASE}/public/quotes/${id}`)
      .then((res) => {
        setQuote(res.data);
        if (res.data.videoPath) {
          if (res.data.videoPath.startsWith('https://player.vimeo.com/')) {
            setVimeoUrl(res.data.videoPath);
          }
        }
        // If already responded
        if (res.data.status === 'accepted' || res.data.status === 'converted') {
          setResponseStatus('accepted');
        } else if (res.data.status === 'rejected') {
          setResponseStatus('rejected');
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!quote) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('pdf') && !params.has('print')) return;

    const timeout = window.setTimeout(() => {
      window.print();
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [quote]);

  const handleResponse = async (action: 'accept' | 'reject') => {
    if (!id) return;
    setSubmitting(true);
    setResponseError(null);
    try {
      await axios.post(`${API_BASE}/public/quotes/${id}/respond`, {
        action,
        clientNotes: clientNotes.trim() || undefined,
      });
      setResponseStatus(action === 'accept' ? 'accepted' : 'rejected');
    } catch (err: any) {
      setResponseError(err?.response?.data?.error || 'שגיאה בשליחת התגובה, נסו שוב');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" dir="rtl">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">הצעה לא נמצאה</h1>
          <p className="text-gray-500">ייתכן שההצעה אינה זמינה עוד.</p>
        </div>
      </div>
    );
  }

  const itemsTotal = quote.items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const discountValue = Number(quote.discount || 0);
  const finalAmount = Number(quote.finalAmount || quote.totalAmount || 0);
  const contentText = typeof quote.content === 'string' ? quote.content : (quote.content as any)?.markdown || quote.generatedContent || '';

  const isProject = (item: QuoteItem) =>
    item.groups === 1 && item.meetingsPerGroup === 1 && item.description;

  const alreadyResponded = responseStatus !== null;

  return (
    <div className="min-h-screen bg-gray-50 print-page" dir="rtl">
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .print-page { background: #fff !important; }
          .print-card { box-shadow: none !important; break-inside: avoid; page-break-inside: avoid; }
          .print-section { padding-top: 12px !important; padding-bottom: 12px !important; }
          header, section, footer { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print fixed bottom-5 left-5 z-50 flex flex-col gap-2">
        <button
          onClick={() => window.print()}
          className="bg-blue-600 text-white font-bold px-5 py-3 rounded-xl shadow-lg hover:bg-blue-700 transition-colors"
        >
          📄 הורד / שמור PDF
        </button>
      </div>

      {/* Header */}
      <header className="bg-gradient-to-l from-blue-600 via-blue-700 to-cyan-600 text-white">
        <div className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">דרך ההייטק</h1>
            <p className="text-blue-100 text-sm mt-1">חינוך טכנולוגי מתקדם</p>
          </div>
          <div className="text-left text-sm text-blue-100">
            <p>הצעה #{quote.quoteNumber}</p>
            <p>{new Date(quote.createdAt).toLocaleDateString('he-IL')}</p>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative bg-gradient-to-bl from-blue-600 to-cyan-500 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <svg className="w-full h-full" viewBox="0 0 1440 320" preserveAspectRatio="none">
            <path fill="currentColor" d="M0,224L48,213.3C96,203,192,181,288,186.7C384,192,480,224,576,218.7C672,213,768,171,864,165.3C960,160,1056,192,1152,197.3C1248,203,1344,181,1392,170.7L1440,160L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z" />
          </svg>
        </div>
        <div className="relative max-w-5xl mx-auto px-4 py-16 md:py-24 text-center">
          <p className="text-blue-100 text-lg mb-2">הצעת מחיר מיוחדת עבור</p>
          <h2 className="text-3xl md:text-5xl font-extrabold mb-4">{quote.institutionName}</h2>
          <p className="text-blue-100 text-lg max-w-2xl mx-auto">
            שמחים להציג בפניכם את ההצעה שהכנו בקפידה. אנו מאמינים שנוכל להוסיף ערך אמיתי למוסד שלכם.
          </p>
        </div>
      </section>

      {/* Video */}
      {(videoUrl || vimeoUrl) && (
        <section className="no-print max-w-5xl mx-auto px-4 py-8">
          <div className="bg-black rounded-2xl overflow-hidden shadow-2xl">
            {vimeoUrl ? (
              <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
                <iframe
                  src={`${vimeoUrl}?autoplay=1&muted=1`}
                  className="absolute inset-0 w-full h-full"
                  frameBorder="0"
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <video
                src={videoUrl!}
                controls
                autoPlay
                muted
                className="w-full"
                style={{ maxHeight: 540 }}
              />
            )}
          </div>
        </section>
      )}

      {/* About */}
      <section className="max-w-5xl mx-auto px-4 py-12 md:py-16 print-section">
        <div className="bg-white rounded-2xl shadow-lg p-8 md:p-12 border border-gray-100 print-card">
          <h3 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span className="w-8 h-1 bg-gradient-to-l from-blue-600 to-cyan-500 rounded-full inline-block"></span>
            מי אנחנו
          </h3>
          <p className="text-gray-600 leading-relaxed text-lg">
            דרך ההייטק היא חברה מובילה בתחום החינוך הטכנולוגי בישראל. אנו מתמחים בהעברת קורסים
            ופרויקטים טכנולוגיים למוסדות חינוך, עם צוות מדריכים מקצועי ותכניות לימוד מותאמות אישית.
            מאות מוסדות חינוך ברחבי הארץ כבר נהנים מהשירותים שלנו, ואנו גאים בשיעורי שביעות הרצון הגבוהים שלנו.
          </p>
        </div>
      </section>

      {/* Services / Items */}
      <section className="max-w-5xl mx-auto px-4 pb-12 md:pb-16 print-section">
        <h3 className="text-2xl font-bold text-gray-800 mb-8 text-center">מה כלול בהצעה</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {quote.items.map((item, idx) => (
            <div
              key={item.id || idx}
              className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 print-card"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-bl from-blue-500 to-cyan-400 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xl">{isProject(item) ? '🛠️' : '🎓'}</span>
                </div>
                <div className="flex-1">
                  <h4 className="text-lg font-bold text-gray-800 mb-2">{item.courseName || 'שירות'}</h4>
                  {isProject(item) ? (
                    <>
                      {item.description && (
                        <p className="text-gray-500 text-sm mb-3">{item.description}</p>
                      )}
                      <p className="text-2xl font-bold text-blue-600">₪{Number(item.subtotal).toLocaleString()}</p>
                    </>
                  ) : (
                    <div className="space-y-1 text-sm text-gray-500">
                      <p>👥 {item.groups} קבוצות</p>
                      <p>📅 {item.meetingsPerGroup} מפגשים לקבוצה</p>
                      <p>⏱️ {item.durationMinutes} דקות למפגש</p>
                      <p className="text-2xl font-bold text-blue-600 pt-2">₪{Number(item.subtotal).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-5xl mx-auto px-4 pb-12 md:pb-16 print-section">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden print-card">
          <div className="bg-gradient-to-l from-blue-600 to-cyan-500 text-white px-8 py-4">
            <h3 className="text-xl font-bold">סיכום מחירים</h3>
          </div>
          <div className="p-8">
            <table className="w-full">
              <tbody>
                {quote.items.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-100">
                    <td className="py-3 text-gray-700">{item.courseName || 'שירות'}</td>
                    <td className="py-3 text-left font-medium">₪{Number(item.subtotal).toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="border-b border-gray-200">
                  <td className="py-3 text-gray-500">סה״כ לפני הנחה</td>
                  <td className="py-3 text-left font-medium">₪{itemsTotal.toLocaleString()}</td>
                </tr>
                {discountValue > 0 && (
                  <tr className="border-b border-gray-200">
                    <td className="py-3 text-red-500">הנחה</td>
                    <td className="py-3 text-left text-red-500 font-medium">-₪{discountValue.toLocaleString()}</td>
                  </tr>
                )}
                <tr>
                  <td className="py-4 text-xl font-bold text-gray-800">
                    {quote.includesVat ? 'סה״כ לתשלום (כולל מע״מ)' : 'סה״כ לתשלום (לא כולל מע״מ)'}
                  </td>
                  <td className="py-4 text-left text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-l from-blue-600 to-cyan-500">
                    ₪{finalAmount.toLocaleString()}
                  </td>
                </tr>
                {!quote.includesVat && (
                  <>
                    <tr className="border-t border-gray-100">
                      <td className="py-2 text-sm text-gray-500">מע״מ (18%)</td>
                      <td className="py-2 text-left text-sm text-gray-500">₪{Math.round(finalAmount * 0.18).toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-semibold text-gray-700">סה״כ כולל מע״מ</td>
                      <td className="py-2 text-left font-semibold text-gray-700">₪{Math.round(finalAmount * 1.18).toLocaleString()}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* AI Content */}
      {contentText && (
        <section className="max-w-5xl mx-auto px-4 pb-12 md:pb-16 print-section">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 md:p-12 print-card">
            <h3 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <span className="w-8 h-1 bg-gradient-to-l from-blue-600 to-cyan-500 rounded-full inline-block"></span>
              פרטים נוספים
            </h3>
            <div className="text-gray-600 leading-relaxed text-lg whitespace-pre-wrap space-y-2">
              {contentText.split('\n').map((line: string, i: number) => {
                const trimmed = line.trim();
                if (!trimmed) return <div key={i} className="h-3" />;
                if (trimmed.length < 60 && !trimmed.endsWith('.') && !trimmed.endsWith(':')) {
                  return <p key={i} className="font-bold text-gray-800 text-xl mt-4">{trimmed}</p>;
                }
                if (trimmed.endsWith(':')) {
                  return <p key={i} className="font-semibold text-gray-700 mt-3">{trimmed}</p>;
                }
                return <p key={i}>{trimmed}</p>;
              })}
            </div>
          </div>
        </section>
      )}

      {/* Terms */}
      {(quote.cancellationTerms || quote.paymentTerms) && (
        <section className="max-w-5xl mx-auto px-4 pb-12 md:pb-16 print-section">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 md:p-12 print-card">
            <h3 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <span className="w-8 h-1 bg-gradient-to-l from-blue-600 to-cyan-500 rounded-full inline-block"></span>
              תנאים
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {quote.paymentTerms && (
                <div>
                  <h4 className="font-semibold text-gray-700 mb-2">💳 תנאי תשלום</h4>
                  <p className="text-gray-600 leading-relaxed">{quote.paymentTerms}</p>
                </div>
              )}
              {quote.cancellationTerms && (
                <div>
                  <h4 className="font-semibold text-gray-700 mb-2">📋 תנאי ביטול</h4>
                  <p className="text-gray-600 leading-relaxed">{quote.cancellationTerms}</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Company Stamp */}
      <section className="max-w-5xl mx-auto px-4 pb-12 md:pb-16 print-section">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 text-center print-card">
          <div className="inline-block border-2 border-gray-300 rounded-xl px-8 py-4">
            <p className="text-xl font-bold text-gray-800">דרך ההייטק בע״מ</p>
            <p className="text-sm text-gray-500 mt-1">חינוך טכנולוגי מתקדם</p>
          </div>
        </div>
      </section>

      {/* CTA / Response Section */}
      <section className="no-print max-w-5xl mx-auto px-4 pb-12 md:pb-16">
        {alreadyResponded ? (
          <div className={`rounded-2xl p-10 md:p-16 text-center shadow-xl ${
            responseStatus === 'accepted'
              ? 'bg-gradient-to-bl from-green-500 to-emerald-600 text-white'
              : 'bg-gradient-to-bl from-red-400 to-red-600 text-white'
          }`}>
            {responseStatus === 'accepted' ? (
              <>
                <div className="text-6xl mb-4">✅</div>
                <h3 className="text-3xl md:text-4xl font-extrabold mb-4">ההצעה אושרה!</h3>
                <p className="text-lg opacity-90">תודה רבה! ניצור אתכם קשר בהקדם להמשך התהליך.</p>
              </>
            ) : (
              <>
                <div className="text-6xl mb-4">❌</div>
                <h3 className="text-3xl md:text-4xl font-extrabold mb-4">ההצעה נדחתה</h3>
                <p className="text-lg opacity-90">תודה על הזמן. נשמח לעמוד לרשותכם בעתיד.</p>
              </>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 md:p-12">
            <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">מה דעתכם?</h3>

            {/* Client notes */}
            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                הערות, בקשות או שאלות (אופציונלי)
              </label>
              <textarea
                value={clientNotes}
                onChange={(e) => setClientNotes(e.target.value)}
                className="w-full border border-gray-300 rounded-xl p-4 text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                rows={4}
                placeholder="אם יש לכם הערות, בקשות לשינויים, שאלות או כל דבר אחר — כתבו כאן..."
                disabled={submitting}
              />
            </div>

            {responseError && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-center">
                {responseError}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => handleResponse('accept')}
                disabled={submitting}
                className="bg-gradient-to-l from-green-500 to-emerald-600 text-white font-bold text-xl px-10 py-4 rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? '⏳ שולח...' : '✅ אשרו את ההצעה'}
              </button>
              <button
                onClick={() => {
                  if (!clientNotes.trim()) {
                    if (!confirm('בטוחים שתרצו לדחות את ההצעה?')) return;
                  }
                  handleResponse('reject');
                }}
                disabled={submitting}
                className="bg-white text-red-500 border-2 border-red-300 font-bold text-xl px-10 py-4 rounded-xl hover:bg-red-50 hover:border-red-400 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? '⏳ שולח...' : '❌ דחו את ההצעה'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-10">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h4 className="text-white text-xl font-bold mb-2">דרך ההייטק</h4>
          <p className="text-sm mb-4">חינוך טכנולוגי מתקדם</p>
          <div className="flex items-center justify-center gap-6 text-sm">
            <span>📧 info@hai.tech</span>
            <span>🌐 hai.tech</span>
          </div>
          <p className="text-xs text-gray-600 mt-6">© {new Date().getFullYear()} דרך ההייטק. כל הזכויות שמורות.</p>
        </div>
      </footer>
    </div>
  );
}
