import { useEffect, useState } from 'react';
import { RefreshCw, MessageCircle } from 'lucide-react';
import api from '../api/client';
import { leadSourceLabel } from '../utils/leadSource';

interface LeadSourceRow {
  channel: string;
  label: string;
  leads: number;
  registered: number;
}

interface LeadSourceReport {
  from: string;
  to: string;
  totals: { leads: number; registered: number };
  channels: LeadSourceRow[];
  topCampaigns: { campaign: string; channel: string; leads: number; registered: number }[];
  topPages: { page: string; leads: number; registered: number }[];
}

function isoDay(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : '—');

/** "מקורות לידים" — new WhatsApp conversations per lead-source channel over the last N days. */
export default function LeadSourcesCard({ days = 30 }: { days?: number }) {
  const [report, setReport] = useState<LeadSourceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const to = isoDay(new Date());
      const from = isoDay(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
      const { data } = await api.get<LeadSourceReport>('/wa/lead-sources', { params: { from, to } });
      setReport(data);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'שגיאה בטעינת מקורות לידים');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const channels = report ? [...report.channels].sort((a, b) => b.leads - a.leads) : [];

  return (
    <div className="bg-white rounded-xl shadow-sm border p-5 mb-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-700 flex items-center gap-2">
          <MessageCircle size={18} className="text-green-600" />
          מקורות לידים — וואטסאפ ({days} ימים)
        </h2>
        <button onClick={load} disabled={loading} className="btn btn-outline btn-sm flex items-center gap-2">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          רענן
        </button>
      </div>

      {error && <div className="text-sm text-red-600 mb-3">⚠️ {error}</div>}

      {loading && !report ? (
        <div className="text-sm text-gray-400 py-6 text-center">טוען…</div>
      ) : report ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b">
                  <th className="text-right py-2 font-medium">ערוץ</th>
                  <th className="text-center py-2 font-medium">לידים</th>
                  <th className="text-center py-2 font-medium">נרשמו</th>
                  <th className="text-center py-2 font-medium">המרה</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.channel} className="border-b last:border-0">
                    <td className="py-2">{c.label || leadSourceLabel(c.channel)}</td>
                    <td className="text-center font-medium">{c.leads}</td>
                    <td className="text-center text-green-700">{c.registered}</td>
                    <td className="text-center text-gray-500">{pct(c.registered, c.leads)}</td>
                  </tr>
                ))}
                <tr className="font-semibold bg-gray-50">
                  <td className="py-2">סה״כ</td>
                  <td className="text-center">{report.totals.leads}</td>
                  <td className="text-center text-green-700">{report.totals.registered}</td>
                  <td className="text-center text-gray-500">{pct(report.totals.registered, report.totals.leads)}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-gray-400 mt-2">
              "נרשמו" = לקוח עם אותו טלפון ונרשם לקורס אחרי תחילת השיחה (התאמה לפי טלפון, הערכה).
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-600 mb-2">קמפיינים / כותרות מובילים</h3>
              {report.topCampaigns.length === 0 ? (
                <p className="text-xs text-gray-400">אין נתונים עדיין</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {report.topCampaigns.map((c) => (
                    <li key={`${c.channel}-${c.campaign}`} className="flex justify-between gap-2">
                      <span className="truncate" title={c.campaign}>
                        {c.campaign} <span className="text-xs text-gray-400">({leadSourceLabel(c.channel)})</span>
                      </span>
                      <span className="text-gray-600 whitespace-nowrap">{c.leads} / <span className="text-green-700">{c.registered}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-600 mb-2">עמודים באתר מובילים</h3>
              {report.topPages.length === 0 ? (
                <p className="text-xs text-gray-400">אין נתונים עדיין</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {report.topPages.map((p) => (
                    <li key={p.page} className="flex justify-between gap-2">
                      <span className="truncate" dir="ltr" title={p.page}>{p.page}</span>
                      <span className="text-gray-600 whitespace-nowrap">{p.leads} / <span className="text-green-700">{p.registered}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
