import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Phone, Mail, MapPin, User, Tag, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';

interface FacebookLead {
  id: number;
  fbLeadId: string;
  adName?: string;
  campaignName?: string;
  adsetName?: string;
  fullName?: string;
  phone?: string;
  email?: string;
  city?: string;
  childName?: string;
  childAge?: string;
  interest?: string;
  status: string;
  notes?: string;
  fbCreatedTime?: string;
  createdAt: string;
  customer?: { id: string; name: string; phone: string };
}

const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  contacted: 'bg-yellow-100 text-yellow-800',
  converted: 'bg-green-100 text-green-800',
  dismissed: 'bg-gray-100 text-gray-600',
};

const statusLabels: Record<string, string> = {
  new: 'חדש',
  contacted: 'בטיפול',
  converted: 'הומר',
  dismissed: 'לא רלוונטי',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[status] || 'bg-gray-100 text-gray-800'}`}>
      {statusLabels[status] || status}
    </span>
  );
}

export default function FacebookLeads() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', '25');
  if (statusFilter) params.set('status', statusFilter);

  const { data, isLoading } = useQuery({
    queryKey: ['facebook-leads', page, statusFilter],
    queryFn: async () => {
      const res = await api.get(`/facebook/leads?${params.toString()}`);
      return res.data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status?: string; notes?: string }) =>
      api.patch(`/facebook/leads/${id}`, { status, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facebook-leads'] });
      setEditingId(null);
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post('/facebook/sync'),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['facebook-leads'] });
      const { imported, skipped } = res.data;
      alert(`✅ סנכרון הושלם!\nיובאו: ${imported} לידים חדשים\nדולגו (קיימים): ${skipped}`);
    },
    onError: (err: any) => {
      alert(`❌ שגיאה בסנכרון:\n${err.response?.data?.message || err.message}`);
    },
  });

  const leads: FacebookLead[] = data?.data || [];
  const pagination = data?.pagination;

  const startEdit = (lead: FacebookLead) => {
    setEditingId(lead.id);
    setEditStatus(lead.status);
    setEditNotes(lead.notes || '');
  };

  const saveEdit = (id: number) => {
    updateMutation.mutate({ id, status: editStatus, notes: editNotes });
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('he-IL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="🔵 לידים מפייסבוק"
        subtitle={`${pagination?.total ?? 0} לידים סה"כ`}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">כל הסטטוסים</option>
          {Object.entries(statusLabels).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>

        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          {syncMutation.isPending ? 'מסנכרן...' : 'סנכרן לידים מפייסבוק'}
        </button>
      </div>

      {/* Setup notice if no leads and no token */}
      {!isLoading && leads.length === 0 && !statusFilter && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <span className="text-blue-600 font-bold text-lg mt-0.5">f</span>
            <div>
              <p className="font-semibold text-blue-900">הגדרת חיבור לפייסבוק</p>
              <p className="text-sm text-blue-700 mt-1">
                כדי להתחיל למשוך לידים, יש להוסיף את <code className="bg-blue-100 px-1 rounded">FB_PAGE_ACCESS_TOKEN</code> לקובץ ה-.env של הבאקאנד.
              </p>
              <p className="text-sm text-blue-700 mt-1">
                לאחר מכן, רשום את ה-Webhook ב-Meta Developers:
                <code className="bg-blue-100 px-1 rounded ml-1">https://crm.orma-ai.com/api/facebook/webhook</code>
              </p>
              <p className="text-sm text-blue-700 mt-1">
                Verify Token: <code className="bg-blue-100 px-1 rounded">haitech-fb-verify-2026</code>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <Loading />
      ) : leads.length === 0 ? (
        <EmptyState title="לא נמצאו לידים מפייסבוק" variant="compact" />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-right py-3 px-4 font-medium text-gray-600 w-8"></th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">שם</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">טלפון</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600 hidden md:table-cell">מודעה</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600 hidden lg:table-cell">עיר</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">סטטוס</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600 hidden sm:table-cell">תאריך</th>
                <th className="py-3 px-4 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {leads.map((lead) => (
                <React.Fragment key={lead.id}>
                  <tr
                    className={`hover:bg-gray-50 cursor-pointer ${expandedId === lead.id ? 'bg-blue-50' : ''}`}
                    onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
                  >
                    <td className="py-3 px-4 text-gray-400">
                      {expandedId === lead.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-900">{lead.fullName || '—'}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {lead.phone ? (
                        <a
                          href={`tel:${lead.phone}`}
                          className="flex items-center gap-1 hover:text-blue-600"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Phone className="w-3 h-3" />
                          {lead.phone}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="py-3 px-4 text-gray-500 hidden md:table-cell text-xs">
                      <div>{lead.campaignName || '—'}</div>
                      {lead.adName && <div className="text-gray-400">{lead.adName}</div>}
                    </td>
                    <td className="py-3 px-4 text-gray-500 hidden lg:table-cell">{lead.city || '—'}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs hidden sm:table-cell">
                      {formatDate(lead.fbCreatedTime || lead.createdAt)}
                    </td>
                    <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                      {editingId !== lead.id ? (
                        <button
                          onClick={() => startEdit(lead)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          עדכן
                        </button>
                      ) : (
                        <button
                          onClick={() => saveEdit(lead.id)}
                          className="text-xs text-green-600 hover:underline font-semibold"
                        >
                          שמור
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* Expanded row */}
                  {expandedId === lead.id && (
                    <tr>
                      <td colSpan={8} className="bg-blue-50 px-6 py-4 border-b border-blue-100">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Details */}
                          <div className="space-y-2">
                            <h4 className="font-semibold text-gray-700 text-sm mb-2">פרטי ליד</h4>
                            {lead.fullName && (
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <User className="w-4 h-4 text-gray-400" />
                                <span>{lead.fullName}</span>
                              </div>
                            )}
                            {lead.phone && (
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <Phone className="w-4 h-4 text-gray-400" />
                                <a href={`tel:${lead.phone}`} className="hover:text-blue-600">{lead.phone}</a>
                                <a
                                  href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-green-600 text-xs hover:underline"
                                >
                                  WhatsApp
                                </a>
                              </div>
                            )}
                            {lead.email && (
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <Mail className="w-4 h-4 text-gray-400" />
                                <span>{lead.email}</span>
                              </div>
                            )}
                            {lead.city && (
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <MapPin className="w-4 h-4 text-gray-400" />
                                <span>{lead.city}</span>
                              </div>
                            )}
                            {lead.childName && (
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <User className="w-4 h-4 text-gray-400" />
                                <span>שם ילד: {lead.childName}{lead.childAge ? `, גיל ${lead.childAge}` : ''}</span>
                              </div>
                            )}
                            {lead.interest && (
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <Tag className="w-4 h-4 text-gray-400" />
                                <span>עניין: {lead.interest}</span>
                              </div>
                            )}
                            <div className="text-xs text-gray-400 mt-2">
                              <div>קמפיין: {lead.campaignName || '—'}</div>
                              <div>מודעה: {lead.adName || '—'}</div>
                              <div>FB Lead ID: {lead.fbLeadId}</div>
                            </div>
                          </div>

                          {/* Edit panel */}
                          <div className="space-y-3">
                            <h4 className="font-semibold text-gray-700 text-sm mb-2">ניהול ליד</h4>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">סטטוס</label>
                              <select
                                value={editingId === lead.id ? editStatus : lead.status}
                                onChange={(e) => {
                                  if (editingId !== lead.id) startEdit(lead);
                                  setEditStatus(e.target.value);
                                }}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                {Object.entries(statusLabels).map(([val, label]) => (
                                  <option key={val} value={val}>{label}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">הערות</label>
                              <textarea
                                value={editingId === lead.id ? editNotes : (lead.notes || '')}
                                onChange={(e) => {
                                  if (editingId !== lead.id) startEdit(lead);
                                  setEditNotes(e.target.value);
                                }}
                                rows={3}
                                placeholder="הוסף הערות..."
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            {editingId === lead.id && (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => saveEdit(lead.id)}
                                  disabled={updateMutation.isPending}
                                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60"
                                >
                                  שמור
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50"
                                >
                                  ביטול
                                </button>
                              </div>
                            )}
                            {lead.customer && (
                              <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                                <p className="text-xs text-green-700 font-medium">מקושר ללקוח ב-CRM</p>
                                <p className="text-sm text-green-800">{lead.customer.name}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50"
          >
            ← הקודם
          </button>
          <span className="text-sm text-gray-600">
            עמוד {page} מתוך {pagination.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50"
          >
            הבא →
          </button>
        </div>
      )}
    </div>
  );
}
