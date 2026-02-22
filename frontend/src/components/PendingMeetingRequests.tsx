import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, X, ChevronDown, ChevronUp, Loader2, Ban, CalendarX } from 'lucide-react';
import { api } from '../api/client';

interface PendingMeeting {
  id: string;
  scheduledDate: string;
  startTime: string;
  status: 'pending_cancellation' | 'pending_postponement';
  notes: string | null;
  instructor: { id: string; name: string; phone?: string };
  cycle: {
    name: string;
    course: { name: string };
    branch: { name: string };
  };
}

async function fetchPendingRequests(): Promise<{ requests: PendingMeeting[] }> {
  const res = await api.get('/instructor-magic/pending-requests');
  return res.data;
}

async function approveRequest(meetingId: string, action: 'approve' | 'reject', adminNotes?: string) {
  const res = await api.post(`/instructor-magic/approve-request/${meetingId}`, { action, adminNotes });
  return res.data;
}

export default function PendingMeetingRequests() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pending-meeting-requests'],
    queryFn: fetchPendingRequests,
    refetchInterval: 60_000, // refresh every minute
  });

  const approveMutation = useMutation({
    mutationFn: ({ meetingId, action, notes }: { meetingId: string; action: 'approve' | 'reject'; notes?: string }) =>
      approveRequest(meetingId, action, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-meeting-requests'] });
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    },
  });

  const handleAction = async (meetingId: string, action: 'approve' | 'reject') => {
    setProcessing(meetingId + action);
    try {
      await approveMutation.mutateAsync({ meetingId, action, notes: adminNotes[meetingId] });
    } finally {
      setProcessing(null);
    }
  };

  const requests = data?.requests ?? [];

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
            const isCancellation = req.status === 'pending_cancellation';
            return (
              <div key={req.id} className="px-4 py-3 bg-white">
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={`mt-1 p-1.5 rounded-lg ${isCancellation ? 'bg-red-100' : 'bg-orange-100'}`}>
                    {isCancellation
                      ? <Ban size={16} className="text-red-600" />
                      : <CalendarX size={16} className="text-orange-600" />}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        isCancellation ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {isCancellation ? 'בקשת ביטול' : 'בקשת דחיה'}
                      </span>
                      <span className="text-sm font-medium text-gray-800">{req.instructor.name}</span>
                      <span className="text-sm text-gray-500">•</span>
                      <span className="text-sm text-gray-600">{req.cycle.course.name}</span>
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      {req.cycle.branch.name} • {formatDate(req.scheduledDate)}
                    </div>
                    {req.notes && (
                      <div className="text-sm text-gray-700 mt-1 bg-gray-50 rounded-lg px-2 py-1">
                        💬 {req.notes}
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
                          onClick={() => handleAction(req.id, 'approve')}
                          disabled={!!processing}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                        >
                          {processing === req.id + 'approve'
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Check size={14} />}
                          אשר
                        </button>
                        <button
                          onClick={() => handleAction(req.id, 'reject')}
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
