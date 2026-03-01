import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Megaphone,
  Plus,
  Trash2,
  Send,
  Users,
  Calendar,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Check,
  Mail,
  MessageCircle,
  Clock,
  X,
} from 'lucide-react';
import { api } from '../api/client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string;
  description?: string;
  channel: string;
  status: string;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  scheduledAt?: string;
  completedAt?: string;
  createdAt: string;
  createdBy: { name: string };
  landingUrl?: string;
  totalClicks?: number;
}

interface AudienceFilters {
  cycleIds?: string[];
  courseIds?: string[];
  branchIds?: string[];
  ageMin?: number;
  ageMax?: number;
  cycleStatus?: 'active' | 'completed' | 'all';
}

interface ContentVariant {
  subject: string;
  contentHtml: string;
  contentWa: string;
}

interface Course {
  id: string;
  name: string;
}

interface Branch {
  id: string;
  name: string;
}

interface Cycle {
  id: string;
  name: string;
  status: string;
  course?: { name: string };
}

// ─── Status config ──────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft: 'טיוטה',
  scheduled: 'מתוזמן',
  sending: 'בשליחה',
  completed: 'הושלם',
  failed: 'נכשל',
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const CHANNEL_LABEL: Record<string, string> = {
  email: '📧 מייל',
  whatsapp: '💬 WhatsApp',
  both: '📧💬 שניהם',
};

// ─── Builder Steps ───────────────────────────────────────────────────────────

const STEPS = [
  { label: 'בסיסי', icon: '📋' },
  { label: 'קהל יעד', icon: '👥' },
  { label: 'תוכן', icon: '✍️' },
  { label: 'תזמון', icon: '📅' },
  { label: 'אישור', icon: '✅' },
];

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Campaigns() {
  const qc = useQueryClient();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  const [step, setStep] = useState(0);

  // Form state
  const [form, setForm] = useState({
    name: '',
    description: '',
    channel: 'email',
  });
  const [filters, setFilters] = useState<AudienceFilters>({
    cycleIds: [],
    courseIds: [],
    branchIds: [],
    cycleStatus: 'all',
  });
  const [content, setContent] = useState({
    subject: '',
    contentHtml: '',
    contentWa: '',
  });
  const [schedule, setSchedule] = useState({
    type: 'now' as 'now' | 'scheduled',
    scheduledAt: '',
  });

  // Working campaign ID (created on step-1 save)
  const [workingId, setWorkingId] = useState<string | null>(null);

  // Audience preview
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);

  // AI variants
  const [variants, setVariants] = useState<ContentVariant[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiContext, setAiContext] = useState('');
  const [testRecipient, setTestRecipient] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [landingUrl, setLandingUrl] = useState('');
  const [selectedVariant, setSelectedVariant] = useState<number | null>(null);

  // ─── Data queries ──────────────────────────────────────────────────────────

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ['campaigns'],
    queryFn: async () => (await api.get('/campaigns')).data,
  });

  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ['courses'],
    queryFn: async () => { const res = (await api.get('/courses')).data; return Array.isArray(res) ? res : (res.data ?? []); },
  });

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => { const res = (await api.get('/branches')).data; return Array.isArray(res) ? res : (res.data ?? []); },
  });

  const { data: allCycles = [] } = useQuery<Cycle[]>({
    queryKey: ['cycles-for-campaigns'],
    queryFn: async () => {
      const res = (await api.get('/cycles?limit=500&status=active')).data;
      return Array.isArray(res) ? res : (res.data ?? []);
    },
  });

  const [cycleSearch, setCycleSearch] = useState('');

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  // ─── Reset builder ─────────────────────────────────────────────────────────

  const openNew = () => {
    setEditCampaign(null);
    setWorkingId(null);
    setStep(0);
    setForm({ name: '', description: '', channel: 'email' });
    setFilters({ cycleIds: [], courseIds: [], branchIds: [], cycleStatus: 'all' });
    setCycleSearch('');
    setContent({ subject: '', contentHtml: '', contentWa: '' });
    setSchedule({ type: 'now', scheduledAt: '' });
    setAudienceCount(null);
    setVariants([]);
    setSelectedVariant(null);
    setAiContext('');
    setLandingUrl('');
    setTestRecipient('');
    setTestResult('');
    setBuilderOpen(true);
  };

  const openEdit = (c: Campaign) => {
    setEditCampaign(c);
    setWorkingId(c.id);
    setStep(0);
    setForm({ name: c.name, description: c.description || '', channel: c.channel });
    setLandingUrl(c.landingUrl || '');
    setTestRecipient('');
    setTestResult('');
    setBuilderOpen(true);
  };

  // ─── Step navigation ───────────────────────────────────────────────────────

  const nextStep = async () => {
    if (step === 0) {
      // Save basic info
      if (!form.name.trim()) return alert('נא להזין שם לקמפיין');
      if (workingId) {
        await api.put(`/campaigns/${workingId}`, { ...form });
      } else {
        const res = await api.post('/campaigns', {
          ...form,
          audienceFilters: filters,
        });
        setWorkingId(res.data.id);
      }
    }
    if (step === 1 && workingId) {
      // Save filters
      await api.put(`/campaigns/${workingId}`, { audienceFilters: filters });
    }
    if (step === 2 && workingId) {
      // Save content + landing URL
      const effectiveLandingUrl = landingUrl || `https://crm.orma-ai.com/campaign/${workingId}`;
      await api.put(`/campaigns/${workingId}`, { ...content, landingUrl: effectiveLandingUrl });
    }
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };

  const prevStep = () => setStep(s => Math.max(s - 1, 0));

  // ─── Audience preview ──────────────────────────────────────────────────────

  const previewAudience = async () => {
    setAudienceLoading(true);
    try {
      const res = await api.post('/campaigns/preview-audience', { filters });
      setAudienceCount(res.data.count);
    } finally {
      setAudienceLoading(false);
    }
  };

  // ─── AI generation ─────────────────────────────────────────────────────────

  const generateAI = async () => {
    if (!workingId) return;
    setAiLoading(true);
    try {
      // First save filters
      await api.put(`/campaigns/${workingId}`, { audienceFilters: filters });
      const res = await api.post(`/campaigns/${workingId}/generate-ai`, { userContext: aiContext || undefined });
      setVariants(res.data.variants || []);
    } finally {
      setAiLoading(false);
    }
  };

  const selectVariant = (i: number) => {
    setSelectedVariant(i);
    const v = variants[i];
    setContent({ subject: v.subject, contentHtml: v.contentHtml, contentWa: v.contentWa });
  };

  // ─── Send campaign ─────────────────────────────────────────────────────────

  const handleTestSend = async () => {
    if (!workingId || !testRecipient.trim()) return;
    setTestSending(true);
    setTestResult('');
    try {
      const isPhone = /^\d/.test(testRecipient.trim());
      const body = isPhone ? { phone: testRecipient.trim() } : { email: testRecipient.trim() };
      const res = await api.post(`/campaigns/${workingId}/test-send`, body);
      setTestResult(`✅ נשלח בהצלחה ל-${res.data.sentTo}`);
    } catch {
      setTestResult('❌ שגיאה בשליחה — בדוק שהקמפיין נשמר');
    } finally {
      setTestSending(false);
    }
  };

  const sendCampaign = async () => {
    if (!workingId) return;
    // Save content first
    await api.put(`/campaigns/${workingId}`, { ...content });
    const body: Record<string, string> = {};
    if (schedule.type === 'scheduled' && schedule.scheduledAt) {
      body.scheduledAt = schedule.scheduledAt;
    }
    await api.post(`/campaigns/${workingId}/send`, body);
    qc.invalidateQueries({ queryKey: ['campaigns'] });
    setBuilderOpen(false);
    alert(schedule.type === 'now' ? '✅ הקמפיין הופעל ונשלח!' : '📅 הקמפיין תוזמן לשליחה!');
  };

  // ─── Render list ───────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className="w-7 h-7 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">קמפיינים שיווקיים</h1>
            <p className="text-sm text-gray-500">שלח מיילים וWA לקהל יעד ממוקד</p>
          </div>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={18} />
          קמפיין חדש
        </button>
      </div>

      {/* Campaigns table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">טוען...</div>
        ) : campaigns.length === 0 ? (
          <div className="p-12 text-center">
            <Megaphone className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">אין קמפיינים עדיין</p>
            <button onClick={openNew} className="mt-3 text-indigo-600 hover:underline">
              צור קמפיין ראשון
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-right px-4 py-3 font-medium text-gray-600">שם</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">ערוץ</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">סטטוס</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">נמענים</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">לחיצות 🔗</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">תזמון/השלמה</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{c.name}</div>
                    {c.description && (
                      <div className="text-xs text-gray-400 truncate max-w-xs">{c.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{CHANNEL_LABEL[c.channel] || c.channel}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${STATUS_CLASS[c.status] || 'bg-gray-100 text-gray-600'}`}
                    >
                      {STATUS_LABEL[c.status] || c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-gray-600">
                      <Users size={14} />
                      {c.recipientCount}
                      {c.status === 'completed' && (
                        <span className="text-xs text-gray-400">
                          ({c.deliveredCount}✓ {c.failedCount}✗)
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(c.totalClicks ?? 0) > 0
                      ? <span className="font-semibold text-blue-600">{c.totalClicks}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {c.scheduledAt
                      ? new Date(c.scheduledAt).toLocaleString('he-IL')
                      : c.completedAt
                      ? new Date(c.completedAt).toLocaleString('he-IL')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {c.status === 'draft' && (
                        <button
                          onClick={() => openEdit(c)}
                          className="text-indigo-600 hover:text-indigo-800 text-xs"
                        >
                          ערוך
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (window.confirm('למחוק את הקמפיין?')) {
                            deleteMutation.mutate(c.id);
                          }
                        }}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── Builder Modal ───────────────────────────────────────────────────── */}
      {builderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">
                {editCampaign ? 'עריכת קמפיין' : 'קמפיין חדש'}
              </h2>
              <button onClick={() => setBuilderOpen(false)}>
                <X size={22} className="text-gray-400 hover:text-gray-700" />
              </button>
            </div>

            {/* Steps indicator */}
            <div className="flex items-center justify-center gap-1 px-6 py-3 bg-gray-50 border-b border-gray-200">
              {STEPS.map((s, i) => (
                <div key={i} className="flex items-center">
                  <button
                    onClick={() => i < step || workingId ? setStep(i) : undefined}
                    className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      i === step
                        ? 'bg-indigo-600 text-white'
                        : i < step
                        ? 'bg-indigo-100 text-indigo-700 cursor-pointer'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    <span>{s.icon}</span>
                    <span>{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <ChevronLeft size={14} className="text-gray-300 mx-1" />
                  )}
                </div>
              ))}
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Step 0 — Basic info */}
              {step === 0 && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900">פרטים בסיסיים</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">שם הקמפיין *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="לדוגמה: קמפיין פתיחת שנה 2025"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">תיאור</label>
                    <textarea
                      value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      rows={2}
                      placeholder="תיאור פנימי לקמפיין..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">ערוץ שליחה</label>
                    <div className="flex gap-3">
                      {[
                        { value: 'email', icon: <Mail size={18} />, label: '📧 מייל' },
                        { value: 'whatsapp', icon: <MessageCircle size={18} />, label: '💬 WhatsApp' },
                        { value: 'both', icon: null, label: '📧💬 שניהם' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setForm(f => ({ ...f, channel: opt.value }))}
                          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border-2 font-medium transition-colors ${
                            form.channel === opt.value
                              ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 1 — Audience */}
              {step === 1 && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900">קהל יעד</h3>

                  {/* Cycles multi-select (primary filter) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      מחזורים ספציפיים
                      {(filters.cycleIds?.length ?? 0) > 0 && (
                        <span className="mr-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                          {filters.cycleIds!.length} נבחרו
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      placeholder="חיפוש מחזור..."
                      value={cycleSearch}
                      onChange={e => setCycleSearch(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <div className="border border-gray-200 rounded-lg p-2 max-h-44 overflow-y-auto space-y-1">
                      {allCycles
                        .filter(c => !cycleSearch || c.name.includes(cycleSearch) || c.course?.name?.includes(cycleSearch))
                        .map(c => (
                          <label key={c.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                            <input
                              type="checkbox"
                              checked={filters.cycleIds?.includes(c.id) || false}
                              onChange={e => {
                                setFilters(f => ({
                                  ...f,
                                  cycleIds: e.target.checked
                                    ? [...(f.cycleIds || []), c.id]
                                    : (f.cycleIds || []).filter(id => id !== c.id),
                                }));
                              }}
                              className="rounded accent-indigo-600"
                            />
                            <span className="text-sm">{c.name}</span>
                            {c.course?.name && (
                              <span className="text-xs text-gray-400">({c.course.name})</span>
                            )}
                          </label>
                        ))}
                      {allCycles.length === 0 && (
                        <p className="text-sm text-gray-400 px-2 py-1">אין מחזורים פעילים</p>
                      )}
                    </div>
                    {(filters.cycleIds?.length ?? 0) > 0 && (
                      <p className="text-xs text-indigo-600 mt-1">
                        ✦ בחרת מחזורים ספציפיים — פילטרי קורס/סניף/סטטוס לא יחולו
                      </p>
                    )}
                  </div>

                  {/* Courses multi-select */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">קורסים (ריק = הכל)</label>
                    <div className="border border-gray-200 rounded-lg p-2 max-h-36 overflow-y-auto space-y-1">
                      {courses.map(c => (
                        <label key={c.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                          <input
                            type="checkbox"
                            checked={filters.courseIds?.includes(c.id) || false}
                            onChange={e => {
                              setFilters(f => ({
                                ...f,
                                courseIds: e.target.checked
                                  ? [...(f.courseIds || []), c.id]
                                  : (f.courseIds || []).filter(id => id !== c.id),
                              }));
                            }}
                            className="rounded accent-indigo-600"
                          />
                          <span className="text-sm">{c.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Branches multi-select */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">סניפים (ריק = הכל)</label>
                    <div className="border border-gray-200 rounded-lg p-2 max-h-36 overflow-y-auto space-y-1">
                      {branches.map(b => (
                        <label key={b.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                          <input
                            type="checkbox"
                            checked={filters.branchIds?.includes(b.id) || false}
                            onChange={e => {
                              setFilters(f => ({
                                ...f,
                                branchIds: e.target.checked
                                  ? [...(f.branchIds || []), b.id]
                                  : (f.branchIds || []).filter(id => id !== b.id),
                              }));
                            }}
                            className="rounded accent-indigo-600"
                          />
                          <span className="text-sm">{b.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Age range */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">גיל מינימום</label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={filters.ageMin ?? ''}
                        onChange={e => setFilters(f => ({ ...f, ageMin: e.target.value ? parseInt(e.target.value) : undefined }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">גיל מקסימום</label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={filters.ageMax ?? ''}
                        onChange={e => setFilters(f => ({ ...f, ageMax: e.target.value ? parseInt(e.target.value) : undefined }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  </div>

                  {/* Cycle status */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">סטטוס מחזור</label>
                    <select
                      value={filters.cycleStatus || 'all'}
                      onChange={e => setFilters(f => ({ ...f, cycleStatus: e.target.value as AudienceFilters['cycleStatus'] }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                    >
                      <option value="all">הכל</option>
                      <option value="active">פעיל</option>
                      <option value="completed">הסתיים</option>
                    </select>
                  </div>

                  {/* Preview button */}
                  <button
                    onClick={previewAudience}
                    disabled={audienceLoading}
                    className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition-colors"
                  >
                    <Users size={16} />
                    {audienceLoading ? 'מחשב...' : 'חשב קהל'}
                  </button>

                  {audienceCount !== null && (
                    <div className="flex items-center gap-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                      <Users className="text-indigo-600" size={18} />
                      <span className="font-semibold text-indigo-700 text-lg">{audienceCount}</span>
                      <span className="text-indigo-600">לקוחות בקהל היעד</span>
                    </div>
                  )}
                </div>
              )}

              {/* Step 2 — Content */}
              {step === 2 && (
                <div className="space-y-4">
                  {/* AI Context Input */}
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <label className="block text-sm font-semibold text-purple-800 mb-1">💡 הנחיות ל-AI (אופציונלי)</label>
                    <textarea
                      value={aiContext}
                      onChange={e => setAiContext(e.target.value)}
                      placeholder="לדוגמה: קמפיין לקראת פסח, להדגיש קורסי קיץ, מחיר מוזל 20%, לשים דגש על כיף ויצירתיות..."
                      rows={2}
                      className="w-full border border-purple-200 rounded-lg p-2.5 text-sm bg-white mt-1 focus:ring-2 focus:ring-purple-400 resize-none"
                    />
                    <p className="text-xs text-purple-500 mt-1">הנחיות אלו יועברו ל-AI לצד נתוני הקהל והטרנדים</p>
                  </div>

                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">תוכן הקמפיין</h3>
                    <button
                      onClick={generateAI}
                      disabled={aiLoading || !workingId}
                      className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white px-4 py-2 rounded-lg transition-all disabled:opacity-50"
                    >
                      <Sparkles size={16} />
                      {aiLoading ? 'יוצר תוכן...' : '✨ צור תוכן עם AI'}
                    </button>
                  </div>

                  {/* AI Variants */}
                  {variants.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm text-gray-600 font-medium">בחר גרסה:</p>
                      <div className="grid gap-2">
                        {variants.map((v, i) => (
                          <button
                            key={i}
                            onClick={() => selectVariant(i)}
                            className={`text-right p-3 rounded-lg border-2 transition-colors ${
                              selectedVariant === i
                                ? 'border-indigo-600 bg-indigo-50'
                                : 'border-gray-200 hover:border-indigo-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              {selectedVariant === i && <Check size={14} className="text-indigo-600" />}
                              <span className="text-xs font-medium text-gray-500">גרסה {i + 1}</span>
                            </div>
                            <p className="font-medium text-sm text-gray-800 truncate">{v.subject}</p>
                            <p className="text-xs text-gray-400 truncate mt-0.5">{v.contentWa.slice(0, 80)}...</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Content editor */}
                  {(form.channel === 'email' || form.channel === 'both') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">נושא מייל</label>
                      <input
                        type="text"
                        value={content.subject}
                        onChange={e => setContent(c => ({ ...c, subject: e.target.value }))}
                        placeholder="נושא המייל..."
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  )}

                  {(form.channel === 'email' || form.channel === 'both') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">תוכן HTML (מייל)</label>
                      <textarea
                        value={content.contentHtml}
                        onChange={e => setContent(c => ({ ...c, contentHtml: e.target.value }))}
                        rows={6}
                        placeholder="תוכן HTML..."
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-xs"
                      />
                      {content.contentHtml && (
                        <div className="mt-2 border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                          <p className="text-xs text-gray-400 mb-1">תצוגה מקדימה:</p>
                          <div
                            className="text-sm"
                            dangerouslySetInnerHTML={{ __html: content.contentHtml }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {(form.channel === 'whatsapp' || form.channel === 'both') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        הודעת WhatsApp
                        <span className="text-xs text-gray-400 mr-1">
                          (השתמש ב-{'{שם_הורה}'} ו-{'{שם_ילד}'} ו-{'{utm_link}'} לקישור מעקב)
                        </span>
                      </label>
                      <textarea
                        value={content.contentWa}
                        onChange={e => setContent(c => ({ ...c, contentWa: e.target.value }))}
                        rows={5}
                        placeholder="שלום {שם_הורה}! ..."
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  )}

                  {/* Landing Page URL */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <label className="block text-sm font-semibold text-blue-800 mb-1">🔗 כתובת נחיתה (landing page URL)</label>
                    <input
                      type="url"
                      value={landingUrl}
                      onChange={e => setLandingUrl(e.target.value)}
                      placeholder={workingId ? `https://crm.orma-ai.com/campaign/${workingId}` : 'https://crm.orma-ai.com/campaign/...'}
                      className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-400 outline-none"
                      dir="ltr"
                    />
                    <p className="text-xs text-blue-500 mt-1">
                      השתמש ב-<code className="bg-blue-100 px-1 rounded">{'{utm_link}'}</code> בתוכן ההודעה כדי להוסיף לינק מעקב אישי לכל נמען
                    </p>
                  </div>
                </div>
              )}

              {/* Step 3 — Schedule */}
              {step === 3 && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900">תזמון שליחה</h3>
                  <div className="flex gap-4">
                    <button
                      onClick={() => setSchedule(s => ({ ...s, type: 'now' }))}
                      className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl border-2 font-medium transition-colors ${
                        schedule.type === 'now'
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <Send size={20} />
                      שלח עכשיו
                    </button>
                    <button
                      onClick={() => setSchedule(s => ({ ...s, type: 'scheduled' }))}
                      className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl border-2 font-medium transition-colors ${
                        schedule.type === 'scheduled'
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <Clock size={20} />
                      תזמן לשליחה
                    </button>
                  </div>

                  {schedule.type === 'scheduled' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">תאריך ושעה לשליחה</label>
                      <input
                        type="datetime-local"
                        value={schedule.scheduledAt}
                        onChange={e => setSchedule(s => ({ ...s, scheduledAt: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  )}

                  {/* Test Send */}
                  <div className="border border-yellow-300 bg-yellow-50 rounded-xl p-4">
                    <h4 className="font-medium text-yellow-800 mb-2 text-sm">📤 שלח הודעת בדיקה לפני השליחה</h4>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="מספר טלפון או מייל לבדיקה"
                        value={testRecipient}
                        onChange={e => { setTestRecipient(e.target.value); setTestResult(''); }}
                        className="flex-1 border border-yellow-200 rounded-lg px-3 py-2 text-sm bg-white"
                        dir="ltr"
                      />
                      <button
                        onClick={handleTestSend}
                        disabled={testSending || !testRecipient.trim() || !workingId}
                        className="px-4 py-2 bg-yellow-500 text-white rounded-lg text-sm font-medium hover:bg-yellow-600 disabled:opacity-50 whitespace-nowrap"
                      >
                        {testSending ? '⏳' : '🧪 שלח בדיקה'}
                      </button>
                    </div>
                    {testResult && <p className="mt-2 text-sm font-medium">{testResult}</p>}
                  </div>
                </div>
              )}

              {/* Step 4 — Confirm */}
              {step === 4 && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900">סיכום ואישור</h3>
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-500">שם קמפיין</span>
                      <span className="font-medium">{form.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">ערוץ</span>
                      <span className="font-medium">{CHANNEL_LABEL[form.channel]}</span>
                    </div>
                    {audienceCount !== null && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">קהל משוער</span>
                        <span className="font-medium text-indigo-700">{audienceCount} לקוחות</span>
                      </div>
                    )}
                    {content.subject && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">נושא מייל</span>
                        <span className="font-medium truncate max-w-xs">{content.subject}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">שליחה</span>
                      <span className="font-medium">
                        {schedule.type === 'now'
                          ? 'מיידית'
                          : schedule.scheduledAt
                          ? new Date(schedule.scheduledAt).toLocaleString('he-IL')
                          : 'לא נבחר'}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={sendCampaign}
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-medium text-base transition-colors"
                  >
                    <Send size={18} />
                    🚀 שלח קמפיין
                  </button>
                </div>
              )}
            </div>

            {/* Footer navigation */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={prevStep}
                disabled={step === 0}
                className="flex items-center gap-1 text-gray-600 hover:text-gray-900 disabled:opacity-30 px-3 py-2 rounded-lg"
              >
                <ChevronRight size={18} />
                הקודם
              </button>
              <span className="text-sm text-gray-400">
                שלב {step + 1} מתוך {STEPS.length}
              </span>
              {step < STEPS.length - 1 ? (
                <button
                  onClick={nextStep}
                  className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  הבא
                  <ChevronLeft size={18} />
                </button>
              ) : (
                <div />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
