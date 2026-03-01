import { useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

interface LeadForm {
  name: string;
  phone: string;
  email: string;
  interest: string;
}

const COURSES = [
  'Scratch - תכנות לילדים',
  'Python - תכנות מתקדם',
  'רובוטיקה',
  'פיתוח משחקים',
  'עיצוב ואנימציה',
  'אחר',
];

export default function CampaignLanding() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [form, setForm] = useState<LeadForm>({ name: '', phone: '', email: '', interest: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      setError('שם וטלפון הם שדות חובה');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await axios.post('/api/campaign-leads', {
        campaignId,
        name: form.name,
        phone: form.phone,
        email: form.email,
        interest: form.interest,
      });
      setSubmitted(true);
    } catch {
      setError('שגיאה בשליחת הפרטים. אנא נסה שוב.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center p-4"
      >
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🙌</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">תודה!</h1>
          <p className="text-gray-600 text-lg">ניצור קשר בקרוב</p>
          <p className="text-gray-400 text-sm mt-2">
            קיבלנו את הפרטים שלך ונחזור אליך בהקדם 🚀
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🎉</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">אנחנו שמחים שחזרת!</h1>
          <p className="text-gray-600">מלא פרטים ונחזור אליך עם כל המידע</p>
        </div>

        {/* Logo / Brand */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 bg-indigo-50 px-4 py-2 rounded-full">
            <span className="text-indigo-600 font-bold text-lg">דרך ההייטק</span>
            <span className="text-2xl">💻</span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              שם מלא <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="שם פרטי ומשפחה"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              טלפון <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="050-0000000"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">מייל (אופציונלי)</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="your@email.com"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">מה מעניין אותך?</label>
            <select
              value={form.interest}
              onChange={e => setForm(f => ({ ...f, interest: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-base bg-white"
            >
              <option value="">-- בחר קורס --</option>
              {COURSES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white py-3 rounded-xl font-semibold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '⏳ שולח...' : '🚀 אני רוצה לשמוע יותר!'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-4">
          לא נשלח ספאם. הפרטים שלך בטוחים אצלנו 🔒
        </p>
      </div>
    </div>
  );
}
