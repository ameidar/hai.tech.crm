import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Phone, X, ChevronDown, ChevronUp, Eye, Save } from 'lucide-react';
import api from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';

interface LeadAppointment {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  childName?: string;
  interest: string;
  source: string;
  vapiCallId?: string;
  callStatus?: string;
  callTranscript?: string;
  callSummary?: string;
  callDuration?: number;
  appointmentDate?: string;
  appointmentTime?: string;
  appointmentNotes?: string;
  appointmentStatus: string;
  whatsappSent?: boolean;
  emailSent?: boolean;
  createdAt: string;
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  queued: 'bg-blue-100 text-blue-800',
  scheduled: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
  no_answer: 'bg-orange-100 text-orange-800',
};

const statusLabels: Record<string, string> = {
  pending: 'ממתין',
  queued: 'בתור',
  scheduled: 'נקבע',
  completed: 'הושלם',
  cancelled: 'בוטל',
  no_answer: 'לא ענה',
};

const allStatuses = ['pending', 'queued', 'scheduled', 'completed', 'cancelled', 'no_answer'];

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[status] || 'bg-gray-100 text-gray-800'}`}>
      {statusLabels[status] || status}
    </span>
  );
}

export default function LeadAppointments() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [selectedLead, setSelectedLead] = useState<LeadAppointment | null>(null);

  // Fetch leads
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', '25');
  if (statusFilter) params.set('status', statusFilter);
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);

  const { data, isLoading } = useQuery({
    queryKey: ['lead-appointments', page, statusFilter, fromDate, toDate],
    queryFn: async () => {
      const res = await api.get(`/lead-appointments?${params.toString()}`);
      return res.data;
    },
  });

  const leads: LeadAppointment[] = data?.data || data || [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <PageHeader title="יומן לידים" />

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap gap-4 items-end">
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
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">תאריך פנייה</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">שם</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">טלפון</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">ילד/ה</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">עניין</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">סטטוס שיחה</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">פגישה</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">סטטוס פגישה</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">פעולות</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedLead(lead)}>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {new Date(lead.createdAt).toLocaleDateString('he-IL')}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium">{lead.customerName}</td>
                  <td className="px-4 py-3 text-sm" dir="ltr">{lead.customerPhone}</td>
                  <td className="px-4 py-3 text-sm">{lead.childName || '-'}</td>
                  <td className="px-4 py-3 text-sm">{lead.interest || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    {lead.callStatus ? <StatusBadge status={lead.callStatus} /> : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {lead.appointmentDate
                      ? `${new Date(lead.appointmentDate).toLocaleDateString('he-IL')} ${lead.appointmentTime || ''}`
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <StatusBadge status={lead.appointmentStatus} />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedLead(lead); }}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {pagination && pagination.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-gray-700">
                עמוד {pagination.page} מתוך {pagination.pages} ({pagination.total} תוצאות)
              </span>
              <div className="flex gap-2">
                <button
                  disabled={!pagination.hasPrev}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                >
                  הקודם
                </button>
                <button
                  disabled={!pagination.hasNext}
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
          onClose={() => setSelectedLead(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['lead-appointments'] });
            setSelectedLead(null);
          }}
        />
      )}
    </div>
  );
}

function LeadDetailModal({
  lead,
  onClose,
  onSaved,
}: {
  lead: LeadAppointment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(lead.appointmentStatus);
  const [date, setDate] = useState(lead.appointmentDate?.split('T')[0] || '');
  const [time, setTime] = useState(lead.appointmentTime || '');
  const [notes, setNotes] = useState(lead.appointmentNotes || '');
  const [showTranscript, setShowTranscript] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/lead-appointments/${lead.id}`, {
        appointmentStatus: status,
        appointmentDate: date || null,
        appointmentTime: time || null,
        appointmentNotes: notes,
      });
      onSaved();
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">פרטי ליד - {lead.customerName}</h2>
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
              <span className="text-gray-500">מקור:</span>
              <span className="mr-2">{lead.source || '-'}</span>
            </div>
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
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">הערות</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="הערות לפגישה..."
            />
          </div>

          <div className="flex justify-end">
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
