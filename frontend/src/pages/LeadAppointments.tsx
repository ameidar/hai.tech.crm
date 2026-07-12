import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Phone, X, ChevronDown, ChevronUp, Eye, Save, Trash2, Plus, AlertCircle, UserCheck, MessageCircle, CalendarCheck, Clock, Flame, CheckCircle2, UserRound, ExternalLink, Search, Send } from 'lucide-react';
import api from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../context/AuthContext';

interface LeadAppointment {
  id: string;
  customerId?: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customer?: { id: string; name: string; phone?: string | null; email?: string | null } | null;
  childName?: string;
  interest: string;
  source: string;
  vapiCallId?: string;
  callStatus?: string;
  callTranscript?: string;
  callSummary?: string;
  callRecordingUrl?: string;
  callDuration?: number;
  appointmentDate?: string;
  appointmentTime?: string;
  appointmentNotes?: string;
  appointmentStatus: string;
  salesStatus: string;
  assignedToId?: string;
  assignedTo?: { id: string; name: string; email: string; role: string };
  nextFollowUpAt?: string;
  lastContactResult?: string;
  lastContactedAt?: string;
  activities?: LeadActivity[];
  whatsappSent?: boolean;
  emailSent?: boolean;
  createdAt: string;
  updatedAt: string;
  // Campaign fields (Facebook)
  campaignId?: string;
  campaignName?: string;
  adId?: string;
  adName?: string;
  adsetName?: string;
  formId?: string;
}

interface LeadActivity {
  id: string;
  type: string;
  result?: string;
  note?: string;
  nextFollowUpAt?: string;
  createdAt: string;
  user?: { id: string; name: string; email: string; role: string };
}

const statusLabels: Record<string, string> = {
  pending: 'ממתין',
  queued: 'בתור',
  scheduled: 'נקבע',
  completed: 'הושלם',
  cancelled: 'בוטל',
  no_answer: 'לא ענה',
};

const allStatuses = ['pending', 'queued', 'scheduled', 'completed', 'cancelled', 'no_answer'];

const salesStatusColors: Record<string, string> = {
  new: 'bg-sky-100 text-sky-800',
  follow_up: 'bg-amber-100 text-amber-800',
  scheduled: 'bg-green-100 text-green-800',
  no_answer: 'bg-orange-100 text-orange-800',
  interested: 'bg-indigo-100 text-indigo-800',
  not_relevant: 'bg-gray-100 text-gray-700',
  converted: 'bg-emerald-100 text-emerald-800',
};

const salesStatusLabels: Record<string, string> = {
  new: 'חדש',
  follow_up: 'צריך לחזור',
  scheduled: 'נקבעה שיחה',
  no_answer: 'לא ענה',
  interested: 'מתעניין',
  not_relevant: 'לא רלוונטי',
  converted: 'נסגר להרשמה',
};

const allSalesStatuses = ['new', 'follow_up', 'scheduled', 'no_answer', 'interested', 'not_relevant', 'converted'];

const contactResultLabels: Record<string, string> = {
  called: 'התקשרתי',
  no_answer: 'לא ענה',
  whatsapp_sent: 'שלחתי WhatsApp',
  green_reply: 'הגיב ב-WhatsApp',
  interested: 'מתעניין',
  scheduled: 'נקבעה שיחה',
  not_relevant: 'לא רלוונטי',
  converted: 'נסגר להרשמה',
  duplicate_inquiry: 'פנייה חוזרת',
};

const allContactResults = ['called', 'no_answer', 'whatsapp_sent', 'interested', 'scheduled', 'not_relevant', 'converted'];

const closedSalesStatuses = ['converted', 'not_relevant'];

function isFollowUpDue(lead: LeadAppointment) {
  if (!lead.nextFollowUpAt || closedSalesStatuses.includes(lead.salesStatus)) return false;
  return new Date(lead.nextFollowUpAt).getTime() <= Date.now();
}

function formatFollowUp(lead: LeadAppointment) {
  if (!lead.nextFollowUpAt) return '-';
  return new Date(lead.nextFollowUpAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

function linkedCustomerId(lead: LeadAppointment) {
  return lead.customer?.id || lead.customerId || null;
}

const quickActions = [
  { key: 'called', label: 'דיברתי', icon: Phone, result: 'called', salesStatus: 'follow_up', appointmentStatus: undefined, note: 'בוצעה שיחה עם הליד' },
  { key: 'no_answer', label: 'לא ענה', icon: Clock, result: 'no_answer', salesStatus: 'no_answer', appointmentStatus: undefined, note: 'לא היה מענה' },
  { key: 'scheduled', label: 'נקבעה', icon: CalendarCheck, result: 'scheduled', salesStatus: 'scheduled', appointmentStatus: 'scheduled', note: 'נקבעה שיחה' },
] as const;

// Source options offered when a salesperson manually adds an external lead
const manualSourceOptions: { value: string; label: string }[] = [
  { value: 'phone', label: 'טלפון' },
  { value: 'referral', label: 'הפניה / המלצה' },
  { value: 'event', label: 'אירוע / תערוכה' },
  { value: 'instagram', label: 'אינסטגרם' },
  { value: 'website', label: 'אתר' },
  { value: 'other', label: 'אחר' },
];

function SalesStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${salesStatusColors[status] || 'bg-gray-100 text-gray-800'}`}>
      {salesStatusLabels[status] || status}
    </span>
  );
}

export default function LeadAppointments() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [salesStatusFilter, setSalesStatusFilter] = useState('');
  const [followUpFilter, setFollowUpFilter] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<'createdAt' | 'updatedAt' | 'nextFollowUpAt'>('updatedAt');
  const [selectedLead, setSelectedLead] = useState<LeadAppointment | null>(null);
  const [whatsAppLead, setWhatsAppLead] = useState<LeadAppointment | null>(null);
  const [showNewLead, setShowNewLead] = useState(false);

  // Deep-link: if ?id=X is in the URL, fetch and auto-open that lead's modal.
  // Only re-runs when the URL id changes — clicking a different lead in the
  // table does NOT retrigger (otherwise it would overwrite the user's choice).
  const deepLinkId = searchParams.get('id');
  useEffect(() => {
    if (!deepLinkId) return;
    let cancelled = false;
    api.get(`/lead-appointments/${deepLinkId}`)
      .then(res => {
        if (cancelled) return;
        const lead = res.data?.data ?? res.data;
        if (lead) setSelectedLead(lead);
      })
      .catch(err => console.error('[LeadAppointments] deep-link fetch failed:', err));
    return () => { cancelled = true; };
  }, [deepLinkId]);

  // Strip the ?id= param when the modal is closed so refreshing doesn't reopen it
  const closeModal = () => {
    setSelectedLead(null);
    if (deepLinkId) {
      searchParams.delete('id');
      setSearchParams(searchParams, { replace: true });
    }
  };

  // Fetch leads
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', '25');
  if (searchQuery.trim()) params.set('search', searchQuery.trim());
  if (statusFilter) params.set('status', statusFilter);
  if (sourceFilter) params.set('source', sourceFilter);
  if (salesStatusFilter) params.set('salesStatus', salesStatusFilter);
  if (followUpFilter) params.set('followUp', followUpFilter);
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);
  if (sortBy !== 'createdAt') params.set('sortBy', sortBy);

  const { data, isLoading } = useQuery({
    queryKey: ['lead-appointments', page, searchQuery, statusFilter, sourceFilter, salesStatusFilter, followUpFilter, fromDate, toDate, sortBy],
    queryFn: async () => {
      const res = await api.get(`/lead-appointments?${params.toString()}`);
      return res.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/lead-appointments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-appointments'] }),
  });

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`למחוק את הליד "${name}"?`)) {
      deleteMutation.mutate(id);
    }
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, appointmentStatus }: { id: string; appointmentStatus: string }) =>
      api.patch(`/lead-appointments/${id}`, { appointmentStatus }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-appointments'] }),
  });

  const quickActionMutation = useMutation({
    mutationFn: ({
      id,
      result,
      salesStatus,
      appointmentStatus,
      note,
    }: {
      id: string;
      result: string;
      salesStatus: string;
      appointmentStatus?: string;
      note: string;
    }) =>
      api.patch(`/lead-appointments/${id}`, {
        salesStatus,
        appointmentStatus,
        lastContactResult: result,
        activityType: result === 'whatsapp_sent' ? 'whatsapp' : 'call',
        activityNote: note,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-appointments'] }),
  });

  const leads: LeadAppointment[] = data?.data || data || [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages || pagination?.pages || 1;
  const urgentCount = leads.filter(isFollowUpDue).length;
  const unassignedCount = leads.filter((lead) => !lead.assignedToId && !lead.assignedTo).length;
  const freshCount = leads.filter((lead) => (lead.salesStatus || 'new') === 'new').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="יומן לידים"
        actions={
          <button
            onClick={() => setShowNewLead(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            ליד חדש
          </button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <button
          onClick={() => { setFollowUpFilter('due'); setSortBy('nextFollowUpAt'); setPage(1); }}
          className={`text-right rounded-lg border p-4 transition-colors ${
            followUpFilter === 'due'
              ? 'border-amber-300 bg-amber-50'
              : 'border-gray-200 bg-white hover:border-amber-200 hover:bg-amber-50/60'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-500">לטיפול עכשיו בעמוד</span>
            <Flame className="w-5 h-5 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{urgentCount}</div>
        </button>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-500">חדשים בעמוד</span>
            <Plus className="w-5 h-5 text-sky-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{freshCount}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-500">ללא אחראי בעמוד</span>
            <UserCheck className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{unassignedCount}</div>
        </div>
        <button
          onClick={() => {
            setStatusFilter('');
            setSourceFilter('');
            setSearchDraft('');
            setSearchQuery('');
            setSalesStatusFilter('');
            setFollowUpFilter('');
            setFromDate('');
            setToDate('');
            setSortBy('updatedAt');
            setPage(1);
          }}
          className="rounded-lg border border-gray-200 bg-white p-4 text-right hover:border-blue-200 hover:bg-blue-50/60 transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-500">תצוגת עבודה</span>
            <CheckCircle2 className="w-5 h-5 text-blue-500" />
          </div>
          <div className="mt-2 text-sm font-medium text-gray-900">איפוס סינונים</div>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap gap-4 items-end">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearchQuery(searchDraft.trim());
            setPage(1);
          }}
          className="min-w-[260px] flex-1"
        >
          <label className="block text-sm font-medium text-gray-700 mb-1">חיפוש לקוח</label>
          <div className="flex rounded-md border border-gray-300 bg-white focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              className="w-full min-w-0 rounded-r-md border-0 px-3 py-2 text-sm focus:ring-0"
              placeholder="שם, טלפון, אימייל או ילד/ה"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft('');
                  setSearchQuery('');
                  setPage(1);
                }}
                title="נקה חיפוש"
                className="inline-flex w-9 items-center justify-center text-gray-400 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              title="חפש"
              className="inline-flex h-[38px] w-10 items-center justify-center rounded-l-md bg-blue-600 text-white hover:bg-blue-700"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>
        </form>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">סטטוס מכירה</label>
          <select
            value={salesStatusFilter}
            onChange={(e) => { setSalesStatusFilter(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {allSalesStatuses.map((s) => (
              <option key={s} value={s}>{salesStatusLabels[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">חזרה</label>
          <select
            value={followUpFilter}
            onChange={(e) => { setFollowUpFilter(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            <option value="due">צריך טיפול עכשיו</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">סטטוס</label>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {allStatuses.map((s) => (
              <option key={s} value={s}>{statusLabels[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">מקור</label>
          <select
            value={sourceFilter}
            onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            <option value="facebook">🔵 פייסבוק</option>
            <option value="website">🌐 אתר</option>
            <option value="whatsapp">💬 WhatsApp</option>
            <option value="vapi">📞 שיחה</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">מתאריך</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">עד תאריך</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">מיון לפי</label>
          <select
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value as 'createdAt' | 'updatedAt' | 'nextFollowUpAt'); setPage(1); }}
            className={`border rounded-md px-3 py-2 text-sm font-medium transition-colors ${sortBy === 'updatedAt' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}
          >
            <option value="createdAt">תאריך פנייה</option>
            <option value="updatedAt">עדכון אחרון</option>
            <option value="nextFollowUpAt">חזרה הבאה</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <Loading />
      ) : leads.length === 0 ? (
        <EmptyState title="אין לידים להצגה" />
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  {sortBy === 'updatedAt' ? 'עודכן' : 'תאריך פנייה'}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">שם</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">טלפון</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">ילד/ה</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">עניין</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">סטטוס מכירה</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">חזרה הבאה</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">אחראי</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">סטטוס פגישה</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">פעולות</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {leads.map((lead) => {
                const due = isFollowUpDue(lead);
                const customerId = linkedCustomerId(lead);
                return (
                <tr
                  key={lead.id}
                  className={`cursor-pointer transition-colors ${
                    due ? 'bg-amber-50 hover:bg-amber-100/70' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedLead(lead)}
                >
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {sortBy === 'updatedAt' ? (
                      <div>
                        <div className="font-medium">{new Date(lead.updatedAt).toLocaleDateString('he-IL')}</div>
                        <div className="text-xs text-gray-400">{new Date(lead.updatedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</div>
                        {new Date(lead.updatedAt) > new Date(lead.createdAt) && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">עודכן</span>
                        )}
                      </div>
                    ) : sortBy === 'nextFollowUpAt' ? (
                      <div>
                        <div className={`font-medium ${due ? 'text-amber-800' : 'text-gray-900'}`}>{formatFollowUp(lead)}</div>
                        {due && <span className="text-xs bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-medium">עכשיו</span>}
                      </div>
                    ) : (
                      new Date(lead.createdAt).toLocaleDateString('he-IL')
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium">{lead.customerName}</td>
                  <td className="px-4 py-3 text-sm" dir="ltr">
                    {lead.customerPhone ? (
                      <a
                        href={`tel:${lead.customerPhone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        {lead.customerPhone}
                      </a>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm">{lead.childName || '-'}</td>
                  <td className="px-4 py-3 text-sm">{lead.interest || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <SalesStatusBadge status={lead.salesStatus || 'new'} />
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <span className={due ? 'font-semibold text-amber-800' : ''}>
                      {formatFollowUp(lead)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">{lead.assignedTo?.name || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <select
                      value={lead.appointmentStatus}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => { e.stopPropagation(); statusMutation.mutate({ id: lead.id, appointmentStatus: e.target.value }); }}
                      className="border border-gray-200 rounded-md px-2 py-1 text-xs bg-white"
                    >
                      {allStatuses.map((s) => (
                        <option key={s} value={s}>{statusLabels[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-1.5">
                      {quickActions.map((action) => {
                        const Icon = action.icon;
                        return (
                          <button
                            key={action.key}
                            title={action.label}
                            onClick={(e) => {
                              e.stopPropagation();
                              quickActionMutation.mutate({
                                id: lead.id,
                                result: action.result,
                                salesStatus: action.salesStatus,
                                appointmentStatus: action.appointmentStatus,
                                note: action.note,
                              });
                            }}
                            disabled={quickActionMutation.isPending}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                          >
                            <Icon className="w-4 h-4" />
                          </button>
                        );
                      })}
                      <button
                        title={lead.customerPhone ? 'שלח WhatsApp דרך Green API' : 'אין מספר טלפון'}
                        onClick={(e) => { e.stopPropagation(); if (lead.customerPhone) setWhatsAppLead(lead); }}
                        disabled={!lead.customerPhone}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-green-200 text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>
                      {customerId && (
                        <Link
                          to={`/customers/${customerId}`}
                          title="פתח כרטיס לקוח"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                        >
                          <UserRound className="w-4 h-4" />
                        </Link>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedLead(lead); }}
                        title="פתח פרטים"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-blue-600 hover:bg-blue-50"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(lead.id, lead.customerName); }}
                        title="מחק"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {pagination && totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-gray-700">
                עמוד {pagination.page} מתוך {totalPages} ({pagination.total} תוצאות)
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                >
                  הקודם
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                >
                  הבא
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          onClose={closeModal}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['lead-appointments'] });
            closeModal();
          }}
          onUpdated={(lead) => {
            setSelectedLead(lead);
            queryClient.invalidateQueries({ queryKey: ['lead-appointments'] });
          }}
        />
      )}

      {/* New Lead Modal */}
      {showNewLead && (
        <NewLeadModal
          onClose={() => setShowNewLead(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['lead-appointments'] });
            setShowNewLead(false);
          }}
        />
      )}

      {whatsAppLead && (
        <LeadWhatsAppModal
          lead={whatsAppLead}
          onClose={() => setWhatsAppLead(null)}
          onSent={() => {
            queryClient.invalidateQueries({ queryKey: ['lead-appointments'] });
            setWhatsAppLead(null);
          }}
        />
      )}
    </div>
  );
}

function LeadWhatsAppModal({
  lead,
  onClose,
  onSent,
}: {
  lead: LeadAppointment;
  onClose: () => void;
  onSent: () => void;
}) {
  const customerId = linkedCustomerId(lead);
  const [message, setMessage] = useState(`שלום ${lead.customerName}, מדברים מדרך ההייטק.`);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const handleSend = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setError('יש לכתוב הודעה לשליחה');
      return;
    }

    setSending(true);
    setError('');
    try {
      await api.post('/communication/whatsapp', {
        phone: lead.customerPhone,
        message: trimmedMessage,
        customerId: customerId || undefined,
        customerName: lead.customerName,
      });
      await api.patch(`/lead-appointments/${lead.id}`, {
        salesStatus: 'follow_up',
        whatsappSent: true,
        lastContactResult: 'whatsapp_sent',
        activityType: 'whatsapp',
        activityNote: `נשלחה הודעת WhatsApp: ${trimmedMessage}`,
      });
      onSent();
    } catch (err: unknown) {
      console.error('Failed to send lead WhatsApp:', err);
      const message = typeof err === 'object' && err && 'response' in err
        ? (err as { response?: { data?: { error?: string; message?: string } } }).response?.data?.message ||
          (err as { response?: { data?: { error?: string; message?: string } } }).response?.data?.error
        : undefined;
      setError(message || 'שגיאה בשליחת הוואטסאפ');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg m-4"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-green-600" />
            <h2 className="text-lg font-semibold">שליחת WhatsApp</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
            <div className="font-medium text-gray-900">{lead.customerName}</div>
            <div className="text-gray-500" dir="ltr">{lead.customerPhone}</div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">הודעה</label>
            <textarea
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (error) setError('');
              }}
              rows={6}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="כתוב הודעה לליד..."
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !message.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {sending ? 'שולח...' : 'שלח ב-WhatsApp'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [childName, setChildName] = useState('');
  const [interest, setInterest] = useState('');
  const [source, setSource] = useState('phone');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [sendWelcome, setSendWelcome] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState<{ id: string; name: string; phone: string; email: string }[]>([]);

  // Look up existing customers by phone/email so the salesperson knows a lead
  // already exists (it will be linked, not duplicated, on the backend).
  useEffect(() => {
    const q = (customerPhone.trim().length >= 3 ? customerPhone.trim() : customerEmail.trim());
    if (q.length < 3) { setDuplicates([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.get(`/customers/lookup?q=${encodeURIComponent(q)}`)
        .then(res => { if (!cancelled) setDuplicates(res.data?.items || []); })
        .catch(() => { if (!cancelled) setDuplicates([]); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [customerPhone, customerEmail]);

  const handleSubmit = async () => {
    if (!customerName.trim() && !customerPhone.trim() && !customerEmail.trim()) {
      setError('יש למלא שם, טלפון או אימייל');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await api.post('/lead-appointments', {
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        childName: childName.trim() || undefined,
        interest: interest.trim() || undefined,
        source,
        appointmentStatus: 'pending',
        appointmentDate: appointmentDate || undefined,
        appointmentTime: appointmentTime || undefined,
        appointmentNotes: appointmentNotes.trim() || undefined,
        sendWelcome,
      });
      onCreated();
    } catch (err: unknown) {
      const message = typeof err === 'object' && err && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      setError(message || 'שגיאה ביצירת הליד');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto m-4"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">ליד חדש</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">שם</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                placeholder="שם ההורה"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">טלפון</label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                dir="ltr"
                placeholder="050-0000000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">אימייל</label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                dir="ltr"
                placeholder="name@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">שם הילד/ה</label>
              <input
                type="text"
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">תחום עניין</label>
              <input
                type="text"
                value={interest}
                onChange={(e) => setInterest(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                placeholder="לדוגמה: תכנות, AI"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">מקור</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                {manualSourceOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Duplicate warning — lead will be linked to the existing customer */}
          {duplicates.length > 0 && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">לקוח קיים במערכת — הליד יקושר אליו (לא ייווצר כפול):</p>
                <ul className="mt-1 space-y-0.5">
                  {duplicates.slice(0, 4).map((d) => (
                    <li key={d.id}>• {d.name} <span dir="ltr" className="text-amber-600">{d.phone || d.email}</span></li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="border-t pt-4">
            <p className="text-sm font-medium text-gray-700 mb-2">פגישה ראשונה (אופציונלי)</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">תאריך</label>
                <input
                  type="date"
                  value={appointmentDate}
                  onChange={(e) => setAppointmentDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">שעה</label>
                <input
                  type="time"
                  value={appointmentTime}
                  onChange={(e) => setAppointmentTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">הערות</label>
            <textarea
              value={appointmentNotes}
              onChange={(e) => setAppointmentNotes(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="הערות..."
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={sendWelcome}
              onChange={(e) => setSendWelcome(e.target.checked)}
              className="w-4 h-4"
            />
            שלח הודעת WhatsApp פתיחה לליד
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 border-t pt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm"
            >
              ביטול
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              <Plus className="w-4 h-4" />
              {saving ? 'יוצר...' : 'צור ליד'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LeadDetailModal({
  lead,
  onClose,
  onSaved,
  onUpdated,
}: {
  lead: LeadAppointment;
  onClose: () => void;
  onSaved: () => void;
  onUpdated: (lead: LeadAppointment) => void;
}) {
  const { user } = useAuth();
  const customerId = linkedCustomerId(lead);
  const [status, setStatus] = useState(lead.appointmentStatus);
  const [salesStatus, setSalesStatus] = useState(lead.salesStatus || 'new');
  const [date, setDate] = useState(lead.appointmentDate?.split('T')[0] || '');
  const [time, setTime] = useState(lead.appointmentTime || '');
  const [nextFollowUpAt, setNextFollowUpAt] = useState(lead.nextFollowUpAt ? lead.nextFollowUpAt.slice(0, 16) : '');
  const [contactResult, setContactResult] = useState('');
  const [activityNote, setActivityNote] = useState('');
  const [notes, setNotes] = useState(lead.appointmentNotes || '');
  const [showTranscript, setShowTranscript] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!nextFollowUpAt) {
      setError('יש למלא תאריך חזרה לפני שמירת הליד');
      return;
    }

    setError('');
    setSaving(true);
    try {
      await api.patch(`/lead-appointments/${lead.id}`, {
        appointmentStatus: status,
        salesStatus,
        appointmentDate: date || null,
        appointmentTime: time || null,
        nextFollowUpAt: nextFollowUpAt || null,
        lastContactResult: contactResult || undefined,
        activityType: contactResult ? 'contact' : activityNote.trim() ? 'note' : undefined,
        activityNote: activityNote.trim() || undefined,
        appointmentNotes: notes,
      });
      onSaved();
    } catch (err: unknown) {
      console.error('Failed to save:', err);
      const message = typeof err === 'object' && err && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      setError(message || 'שגיאה בשמירת הליד');
    } finally {
      setSaving(false);
    }
  };

  const handleTakeOwnership = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const res = await api.patch(`/lead-appointments/${lead.id}`, {
        assignedToId: user.id,
        activityType: 'assignment',
        activityNote: `${user.name} לקח/ה אחריות על הליד`,
      });
      const updatedLead = res.data?.data ?? res.data;
      if (updatedLead) onUpdated(updatedLead);
    } catch (err) {
      console.error('Failed to take ownership:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">פרטי ליד - {lead.customerName}</h2>
            {customerId && (
              <Link
                to={`/customers/${customerId}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
              >
                <UserRound className="w-4 h-4" />
                כרטיס לקוח
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Lead Info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">שם:</span>
              <span className="mr-2 font-medium">{lead.customerName}</span>
            </div>
            <div>
              <span className="text-gray-500">טלפון:</span>
              <span className="mr-2" dir="ltr">{lead.customerPhone}</span>
            </div>
            <div>
              <span className="text-gray-500">אימייל:</span>
              <span className="mr-2" dir="ltr">{lead.customerEmail || '-'}</span>
            </div>
            {lead.childName && (
              <div>
                <span className="text-gray-500">ילד/ה:</span>
                <span className="mr-2">{lead.childName}</span>
              </div>
            )}
            <div>
              <span className="text-gray-500">עניין:</span>
              <span className="mr-2">{lead.interest || '-'}</span>
            </div>
            <div>
              <span className="text-gray-500">סטטוס מכירה:</span>
              <span className="mr-2"><SalesStatusBadge status={lead.salesStatus || 'new'} /></span>
            </div>
            <div>
              <span className="text-gray-500">אחראי:</span>
              <span className="mr-2">{lead.assignedTo?.name || '-'}</span>
            </div>
            <div>
              <span className="text-gray-500">חזרה הבאה:</span>
              <span className="mr-2">
                {lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toLocaleString('he-IL') : '-'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">תוצאה אחרונה:</span>
              <span className="mr-2">{lead.lastContactResult ? contactResultLabels[lead.lastContactResult] || lead.lastContactResult : '-'}</span>
            </div>
            <div>
              <span className="text-gray-500">מקור:</span>
              <span className={`mr-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                lead.source === 'facebook' ? 'bg-blue-100 text-blue-800' :
                lead.source === 'whatsapp' ? 'bg-green-100 text-green-800' :
                lead.source === 'vapi' ? 'bg-purple-100 text-purple-800' :
                'bg-gray-100 text-gray-700'
              }`}>
                {lead.source === 'facebook' ? '🔵 פייסבוק' :
                 lead.source === 'whatsapp' ? '💬 WhatsApp' :
                 lead.source === 'vapi' ? '📞 שיחה' :
                 lead.source === 'website' ? '🌐 אתר' :
                 lead.source || '-'}
              </span>
            </div>
            {/* Campaign details — Facebook only */}
            {lead.source === 'facebook' && (lead.campaignName || lead.campaignId) && (
              <div className="mt-2 p-3 bg-blue-50 rounded-lg border border-blue-100 space-y-1 text-sm">
                <p className="font-medium text-blue-800 mb-1">📊 פרטי קמפיין</p>
                {lead.campaignName && (
                  <div className="flex gap-2">
                    <span className="text-gray-500 w-24 shrink-0">קמפיין:</span>
                    <span className="font-medium">{lead.campaignName}</span>
                    {lead.campaignId && <span className="text-gray-400 text-xs">({lead.campaignId})</span>}
                  </div>
                )}
                {lead.adsetName && (
                  <div className="flex gap-2">
                    <span className="text-gray-500 w-24 shrink-0">Ad Set:</span>
                    <span>{lead.adsetName}</span>
                  </div>
                )}
                {lead.adName && (
                  <div className="flex gap-2">
                    <span className="text-gray-500 w-24 shrink-0">מודעה:</span>
                    <span>{lead.adName}</span>
                    {lead.adId && <span className="text-gray-400 text-xs">({lead.adId})</span>}
                  </div>
                )}
                {lead.formId && (
                  <div className="flex gap-2">
                    <span className="text-gray-500 w-24 shrink-0">Form ID:</span>
                    <span className="text-gray-600 text-xs font-mono">{lead.formId}</span>
                  </div>
                )}
              </div>
            )}
            <div>
              <span className="text-gray-500">תאריך פנייה:</span>
              <span className="mr-2">{new Date(lead.createdAt).toLocaleString('he-IL')}</span>
            </div>
            <div>
              <span className="text-gray-500">משך שיחה:</span>
              <span className="mr-2">{lead.callDuration ? `${Math.round(lead.callDuration / 60)} דקות` : '-'}</span>
            </div>
            <div>
              <span className="text-gray-500">WhatsApp:</span>
              <span className="mr-2">{lead.whatsappSent ? '✅ נשלח' : '❌'}</span>
            </div>
            <div>
              <span className="text-gray-500">אימייל:</span>
              <span className="mr-2">{lead.emailSent ? '✅ נשלח' : '❌'}</span>
            </div>
          </div>

          {/* Call Summary */}
          {lead.callSummary && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-1">סיכום שיחה</h3>
              <p className="text-sm bg-gray-50 rounded p-3">{lead.callSummary}</p>
            </div>
          )}

          {/* Call Recording */}
          {lead.callRecordingUrl && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-1">🎙️ הקלטת שיחה</h3>
              <audio controls className="w-full" preload="metadata">
                <source src={lead.callRecordingUrl} />
                הדפדפן לא תומך בנגן אודיו.
              </audio>
            </div>
          )}

          {/* Call Transcript (collapsible) */}
          {lead.callTranscript && (
            <div>
              <button
                onClick={() => setShowTranscript(!showTranscript)}
                className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                תמליל שיחה
                {showTranscript ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showTranscript && (
                <pre className="text-xs bg-gray-50 rounded p-3 mt-1 whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {lead.callTranscript}
                </pre>
              )}
            </div>
          )}

          <hr />

          {/* Editable fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">סטטוס מכירה</label>
              <select
                value={salesStatus}
                onChange={(e) => setSalesStatus(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                {allSalesStatuses.map((s) => (
                  <option key={s} value={s}>{salesStatusLabels[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">סטטוס פגישה</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                {allStatuses.map((s) => (
                  <option key={s} value={s}>{statusLabels[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">תאריך פגישה</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">שעת פגישה</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">תאריך חזרה *</label>
              <input
                type="datetime-local"
                value={nextFollowUpAt}
                onChange={(e) => {
                  setNextFollowUpAt(e.target.value);
                  if (error) setError('');
                }}
                required
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  error && !nextFollowUpAt ? 'border-red-300 bg-red-50' : 'border-gray-300'
                }`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">תוצאת קשר</label>
              <select
                value={contactResult}
                onChange={(e) => setContactResult(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">ללא עדכון</option>
                {allContactResults.map((r) => (
                  <option key={r} value={r}>{contactResultLabels[r]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">הערת פעילות חדשה</label>
            <textarea
              value={activityNote}
              onChange={(e) => setActivityNote(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="מה קרה בשיחה האחרונה?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">הערות פגישה</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="הערות לפגישה..."
            />
          </div>

          {lead.activities && lead.activities.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">פעילות אחרונה</h3>
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {lead.activities.map((activity) => (
                  <div key={activity.id} className="rounded-md border border-gray-200 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
                      <span>{activity.user?.name || 'מערכת'}</span>
                      <span>{new Date(activity.createdAt).toLocaleString('he-IL')}</span>
                    </div>
                    <div className="mt-1 font-medium">
                      {activity.result ? contactResultLabels[activity.result] || activity.result : activity.type}
                    </div>
                    {activity.note && <div className="mt-1 text-gray-700 whitespace-pre-wrap">{activity.note}</div>}
                    {activity.nextFollowUpAt && (
                      <div className="mt-1 text-xs text-amber-700">
                        חזרה: {new Date(activity.nextFollowUpAt).toLocaleString('he-IL')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-between gap-2">
            <button
              onClick={handleTakeOwnership}
              disabled={saving || !user?.id}
              className="flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm"
            >
              <UserCheck className="w-4 h-4" />
              קח אחריות
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              <Save className="w-4 h-4" />
              {saving ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
