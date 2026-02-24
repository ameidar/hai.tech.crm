import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, X, ChevronDown, ChevronUp, Loader2, Ban, CalendarX, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import type { MeetingChangeRequest } from '../hooks/useApi';

async function fetchPendingRequests(): Promise<MeetingChangeRequest[]> {
  const res = await api.get('/meeting-requests?status=pending');
  return res.data;
}

async function approveRequest(id: string) {
  const res = await api.put(`/meeting-requests/${id}/approve`);
  return res.data;
}

async function rejectRequest(id: string, reason?: string) {
  const res = await api.put(`/meeting-requests/${id}/reject`, { reason });
  return res.data;
}

const typeConfig: Record<string, { label: string; icon: ReactNode; color: string }> = {
  cancel: {
    label: 'בקשת ביטול',
    icon: <Ban size={16} className="text-red-600" />,
    color: 'bg-red-100 text-red-700',
  },
  postpone: {
    label: 'בקשת דחיה',
    icon: <CalendarX size={16} className="text-orange-600" />,
    color: 'bg-orange-100 text-orange-700',
  },
  replacement: {
    label: 'בקשת החלפה',
    icon: <RefreshCw size={16} className="text-blue-600" />,
    color: 'bg-blue-100 text-blue-700',
  },
};

export default function PendingMeetingRequests() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['pending-meeting-requests'],
    queryFn: fetchPendingRequests,
    refetchInterval: 60_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-meeting-requests'] });
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => rejectRequest(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-meeting-requests'] });
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    },
  });

  const handleApprove = async (id: string) => {
    setProcessing(id + 'approve');
    try {
      await approveMutation.mutateAsync(id);
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (id: string) => {
    setProcessing(id + 'reject');
    try {
      await rejectMutation.mutateAsync({ id, reason: adminNotes[id] });
    } finally {
      setProcessing(null);
    }
  };

  if (isLoading) return null;
  if (requests.length === 0) return null;

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-orange-100 transition-colors"
      >
        <AlertCircle size={20} className="text-orange-600 shrink-0" />
        <span className="font-semibold text-orange-800 flex-1">
          {requests.length} בקשות ממתינות לאישור
        </span>
        {expanded ? <ChevronUp size={18} className="text-orange-600" /> : <ChevronDown size={18} className="text-orange-600" />}
      </button>

      {/* List */}
      {expanded && (
        <div className="divide-y divide-orange-100">
          {requests.map((req) => {
            const cfg = typeConfig[req.type] ?? typeConfig.cancel;
            return (
              <div key={req.id} className="px-4 py-3 bg-white">
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className="mt-1 p-1.5 rounded-lg bg-gray-100">
                    {cfg.icon}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      <span className="text-sm font-medium text-gray-800">{req.instructor?.name}</span>
                      {req.meeting?.cycle?.name && (
                        <>
                          <span className="text-sm text-gray-500">•</span>
                          <span className="text-sm text-gray-600">{req.meeting.cycle.name}</span>
                        </>
                      )}
                    </div>
                    {req.meeting?.scheduledDate && (
                      <div className="text-sm text-gray-500 mt-0.5">
                        {req.meeting.cycle?.branch?.name && `${req.meeting.cycle.branch.name} • `}
                        {formatDate(req.meeting.scheduledDate)}
                        {req.meeting.startTime && ` • ${new Date(req.meeting.startTime).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`}
                      </div>
                    )}
                    {req.reason && (
                      <div className="text-sm text-gray-700 mt-1 bg-gray-50 rounded-lg px-2 py-1">
                        💬 {req.reason}
                      </div>
                    )}

                    {/* Admin notes + actions */}
                    <div className="mt-2 flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        placeholder="הערה לאדמין (אופציונלי)"
                        value={adminNotes[req.id] || ''}
                        onChange={(e) => setAdminNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                        className="flex-1 text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(req.id)}
                          disabled={!!processing}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                        >
                          {processing === req.id + 'approve'
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Check size={14} />}
                          אשר
                        </button>
                        <button
                          onClick={() => handleReject(req.id)}
                          disabled={!!processing}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                        >
                          {processing === req.id + 'reject'
                            ? <Loader2 size={14} className="animate-spin" />
                            : <X size={14} />}
                          דחה
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
