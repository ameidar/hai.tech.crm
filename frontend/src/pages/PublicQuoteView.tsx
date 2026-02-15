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
  generatedContent?: string;
  content?: string;
  notes?: string;
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

  useEffect(() => {
    if (!id) return;
    axios
      .get(`${API_BASE}/public/quotes/${id}`)
      .then((res) => {
        setQuote(res.data);
        // Check if video exists
        axios
          .get(`${API_BASE}/quotes/${id}/video`)
          .then((vRes) => {
            // Vimeo JSON response
            if (vRes.data && typeof vRes.data === 'object' && vRes.data.vimeoUrl) {
              setVimeoUrl(vRes.data.vimeoUrl);
            } else if (vRes.data instanceof Blob && vRes.data.type.startsWith('video/')) {
              setVideoUrl(URL.createObjectURL(vRes.data));
            }
          })
          .catch(() => {}); // No video, that's fine
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

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
  const contentText = typeof quote.content === 'string' ? quote.content : quote.generatedContent || '';

  const isProject = (item: QuoteItem) =>
    item.groups === 1 && item.meetingsPerGroup === 1 && item.description;

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
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
        <section className="max-w-5xl mx-auto px-4 py-8">
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
      <section className="max-w-5xl mx-auto px-4 py-12 md:py-16">
        <div className="bg-white rounded-2xl shadow-lg p-8 md:p-12 border border-gray-100">
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
      <section className="max-w-5xl mx-auto px-4 pb-12 md:pb-16">
        <h3 className="text-2xl font-bold text-gray-800 mb-8 text-center">מה כלול בהצעה</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {quote.items.map((item, idx) => (
            <div
              key={item.id || idx}
              className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
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
      <section className="max-w-5xl mx-auto px-4 pb-12 md:pb-16">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
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
                  <td className="py-4 text-xl font-bold text-gray-800">סה״כ לתשלום</td>
                  <td className="py-4 text-left text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-l from-blue-600 to-cyan-500">
                    ₪{finalAmount.toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* AI Content */}
      {contentText && (
        <section className="max-w-5xl mx-auto px-4 pb-12 md:pb-16">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 md:p-12">
            <h3 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <span className="w-8 h-1 bg-gradient-to-l from-blue-600 to-cyan-500 rounded-full inline-block"></span>
              פרטים נוספים
            </h3>
            <div className="text-gray-600 leading-relaxed text-lg whitespace-pre-wrap space-y-2">
              {contentText.split('\n').map((line, i) => {
                const trimmed = line.trim();
                if (!trimmed) return <div key={i} className="h-3" />;
                // Bold lines that look like headers (short, no period)
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

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-4 pb-12 md:pb-16 text-center">
        <div className="bg-gradient-to-bl from-blue-600 to-cyan-500 rounded-2xl p-10 md:p-16 text-white shadow-xl">
          <h3 className="text-3xl md:text-4xl font-extrabold mb-4">מעוניינים להתחיל?</h3>
          <p className="text-blue-100 text-lg mb-8 max-w-xl mx-auto">
            נשמח לענות על כל שאלה ולהתחיל בעבודה משותפת
          </p>
          <button className="bg-white text-blue-600 font-bold text-xl px-10 py-4 rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300">
            אשרו את ההצעה ✅
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-10">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h4 className="text-white text-xl font-bold mb-2">דרך ההייטק</h4>
          <p className="text-sm mb-4">חינוך טכנולוגי מתקדם</p>
          <div className="flex items-center justify-center gap-6 text-sm">
            <span>📧 info@hai.tech</span>
            <span>📞 03-1234567</span>
            <span>🌐 hai.tech</span>
          </div>
          <p className="text-xs text-gray-600 mt-6">© {new Date().getFullYear()} דרך ההייטק. כל הזכויות שמורות.</p>
        </div>
      </footer>
    </div>
  );
}
