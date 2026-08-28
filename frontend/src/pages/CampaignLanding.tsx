import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

interface LeadForm {
  name: string;
  phone: string;
  email: string;
  interest: string;
  children: ChildForm[];
}

interface ChildForm {
  childName: string;
  childAge: string;
  grade: string;
}

interface CampaignLandingData {
  campaign: {
    id: string;
    name: string;
    description?: string | null;
    cycleId?: string | null;
  };
  cycle?: {
    id: string;
    name: string;
    courseName: string;
    branchName: string;
    instructorName: string;
    startDate: string;
    startTime: string;
    durationMinutes: number;
    totalMeetings: number;
    defaultRegistrationAmount?: number | string | null;
    minimumStudentsThreshold?: number | null;
    isOnline: boolean;
    videoProvider?: string | null;
  } | null;
  payment?: {
    url: string;
    amount?: number | string | null;
    maxPayments?: number | null;
  } | null;
}

interface SubmitResult {
  payment?: {
    url: string;
    amount?: number | string | null;
    maxPayments?: number | null;
  } | null;
  registration?: {
    status?: string;
  };
  registrations?: Array<{
    status?: string;
    registrationId?: string;
    studentId?: string;
  }>;
}

const COURSES = [
  'רובלוקס',
  'מיינקראפט',
  'Scratch - תכנות לילדים',
  'Python - תכנות מתקדם',
  'רובוטיקה',
  'פיתוח משחקים',
  'עיצוב ואנימציה',
  'אחר',
];

function emptyChild(): ChildForm {
  return {
    childName: '',
    childAge: '',
    grade: '',
  };
}

function formatDate(value?: string): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

function formatTime(value?: string): string {
  if (!value) return '';
  const match = value.match(/T(\d{2}:\d{2})/);
  if (match) return match[1];
  return value.slice(0, 5);
}

function formatAmount(value?: number | string | null): string {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function CampaignLanding() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [form, setForm] = useState<LeadForm>({
    name: '',
    phone: '',
    email: '',
    interest: '',
    children: [emptyChild()],
  });
  const [landingData, setLandingData] = useState<CampaignLandingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadCampaign() {
      if (!campaignId) {
        setLoading(false);
        return;
      }

      try {
        const res = await axios.get<CampaignLandingData>(`/api/campaign-leads/${campaignId}`);
        if (!active) return;
        setLandingData(res.data);
        const defaultInterest = res.data.cycle?.courseName || '';
        setForm(current => ({ ...current, interest: defaultInterest }));
      } catch {
        if (!active) return;
        setLandingData(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadCampaign();
    return () => {
      active = false;
    };
  }, [campaignId]);

  const cycle = landingData?.cycle;
  const payment = submitResult?.payment || landingData?.payment || null;
  const paymentAmount = formatAmount(payment?.amount || cycle?.defaultRegistrationAmount);
  const isCycleRegistration = Boolean(cycle);

  const details = useMemo(() => {
    if (!cycle) return [];
    return [
      `${cycle.totalMeetings} מפגשים`,
      `${cycle.durationMinutes} דקות למפגש`,
      formatDate(cycle.startDate),
      `שעה ${formatTime(cycle.startTime)}`,
      cycle.isOnline ? 'אונליין' : cycle.branchName,
    ].filter(Boolean);
  }, [cycle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const children = form.children
      .map(child => ({
        childName: child.childName.trim(),
        childAge: child.childAge.trim(),
        grade: child.grade.trim(),
      }))
      .filter(child => child.childName);

    if (!form.name.trim() || !form.phone.trim()) {
      setError('שם הורה וטלפון הם שדות חובה');
      return;
    }
    if (isCycleRegistration && children.length === 0) {
      setError('שם הילד הוא שדה חובה להרשמה למחזור, ואפשר להוסיף כמה ילדים');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await axios.post<SubmitResult>('/api/campaign-leads', {
        campaignId,
        name: form.name,
        phone: form.phone,
        email: form.email,
        interest: form.interest || cycle?.courseName,
        children,
      });
      setSubmitResult(res.data);
      setSubmitted(true);
    } catch (err) {
      const message = axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
        ? err.response.data.error
        : 'שגיאה בשליחת הפרטים. אנא נסה שוב.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    const registrations = submitResult?.registrations || (submitResult?.registration ? [submitResult.registration] : []);
    const registeredCount = registrations.filter(reg => reg.status === 'registered').length;
    const alreadyRegisteredCount = registrations.filter(reg => reg.status === 'already_registered').length;
    const childNames = form.children.map(child => child.childName.trim()).filter(Boolean).join(', ');
    const alreadyRegistered = registeredCount === 0 && alreadyRegisteredCount > 0;
    return (
      <div dir="rtl" className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">✓</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {alreadyRegistered ? 'ההרשמה כבר קיימת' : 'ההרשמה נקלטה'}
          </h1>
          <p className="text-gray-600 text-lg">
            {cycle
              ? `שמנו את ${childNames} ברשימת ההרשמה ל${cycle.name}.`
              : 'קיבלנו את הפרטים ונחזור אליך בהקדם.'}
          </p>
          {cycle && alreadyRegisteredCount > 0 && (
            <p className="mt-3 text-sm text-amber-700">
              {alreadyRegisteredCount} מתוך הילדים כבר היו רשומים למחזור.
            </p>
          )}
          {payment?.url && (
            <a
              href={payment.url}
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-5 py-3 text-base font-semibold text-white hover:bg-indigo-700"
            >
              מעבר לתשלום{paymentAmount ? ` - ${paymentAmount}` : ''}
            </a>
          )}
          <p className="text-gray-400 text-sm mt-4">
            צוות דרך ההייטק יעדכן אותך בפרטים נוספים לפני תחילת המחזור.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 max-w-lg w-full">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🎮</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {cycle?.name || landingData?.campaign.name || 'דרך ההייטק'}
          </h1>
          <p className="text-gray-600">
            {cycle
              ? 'מלאו פרטים להרשמה למחזור, ובסיום תוכלו להשלים תשלום.'
              : 'מלאו פרטים ונחזור אליכם עם כל המידע.'}
          </p>
        </div>

        {loading && (
          <div className="text-center text-gray-500 py-6">טוען פרטי קמפיין...</div>
        )}

        {!loading && cycle && (
          <div className="mb-6 rounded-lg border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-950">
            <div className="font-semibold mb-2">{cycle.courseName}</div>
            <div className="flex flex-wrap gap-2">
              {details.map(item => (
                <span key={item} className="rounded-md bg-white px-2 py-1">
                  {item}
                </span>
              ))}
            </div>
            <div className="mt-3 text-indigo-900">
              מדריכה: {cycle.instructorName}
              {paymentAmount ? ` | מחיר למחזור: ${paymentAmount}` : ''}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              שם הורה <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="שם פרטי ומשפחה"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
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
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">מייל</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="your@email.com"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {form.children.map((child, index) => (
              <div key={index} className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-gray-700">פרטי ילד {index + 1}</span>
                  {form.children.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        children: f.children.filter((_, childIndex) => childIndex !== index),
                      }))}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      הסרה
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      שם הילד{isCycleRegistration && <span className="text-red-500"> *</span>}
                    </label>
                    <input
                      type="text"
                      value={child.childName}
                      onChange={e => setForm(f => ({
                        ...f,
                        children: f.children.map((item, childIndex) => childIndex === index
                          ? { ...item, childName: e.target.value }
                          : item),
                      }))}
                      placeholder="שם הילד"
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-base bg-white"
                      required={isCycleRegistration && index === 0}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">גיל הילד</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={child.childAge}
                      onChange={e => setForm(f => ({
                        ...f,
                        children: f.children.map((item, childIndex) => childIndex === index
                          ? { ...item, childAge: e.target.value }
                          : item),
                      }))}
                      placeholder="10"
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-base bg-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">כיתה</label>
                    <input
                      type="text"
                      value={child.grade}
                      onChange={e => setForm(f => ({
                        ...f,
                        children: f.children.map((item, childIndex) => childIndex === index
                          ? { ...item, grade: e.target.value }
                          : item),
                      }))}
                      placeholder="למשל: ה׳"
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-base bg-white"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, children: [...f.children, emptyChild()] }))}
              className="sm:col-span-2 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              הוספת ילד נוסף
            </button>
          </div>

          {!cycle && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">מה מעניין אותך?</label>
              <select
                value={form.interest}
                onChange={e => setForm(f => ({ ...f, interest: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-base bg-white"
              >
                <option value="">-- בחר קורס --</option>
                {COURSES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'שולח...' : (cycle ? 'הרשמה למחזור' : 'אני רוצה לשמוע יותר')}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-4">
          הפרטים נשמרים במערכת דרך ההייטק לצורך הרשמה ותיאום הקורס.
        </p>
      </div>
    </div>
  );
}
