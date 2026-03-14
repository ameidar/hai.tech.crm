import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp,
  MousePointerClick,
  DollarSign,
  Target,
  RefreshCw,
  Play,
  Pause,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { api } from '../api/client';

// ─── Types ────────────────────────────────────────────────────────────────────
interface GoogleAdsCampaign {
  id: string;
  name: string;
  status: 'active' | 'paused';
  channelType: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  costPerConversion: number | null;
}

interface GoogleAdsSummary {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
  costPerConversion: number | null;
  days: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatNum = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

const formatCost = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CHANNEL_LABEL: Record<string, string> = {
  SEARCH: 'חיפוש',
  DISPLAY: 'תצוגה',
  SHOPPING: 'שופינג',
  VIDEO: 'וידאו',
  SMART: 'חכם',
  PERFORMANCE_MAX: 'Performance Max',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function GoogleAdsCampaigns() {
  const qc = useQueryClient();
  const [days, setDays] = useState(30);

  // Status check
  const { data: statusData } = useQuery({
    queryKey: ['google-ads-status'],
    queryFn: async () => (await api.get('/google-ads/status')).data as { configured: boolean; customerId: string | null },
  });

  // Summary
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['google-ads-summary', days],
    queryFn: async () => (await api.get(`/google-ads/summary?days=${days}`)).data as GoogleAdsSummary,
    enabled: statusData?.configured,
  });

  // Campaigns list
  const { data: campaigns = [], isLoading: campaignsLoading, refetch } = useQuery({
    queryKey: ['google-ads-campaigns', days],
    queryFn: async () => (await api.get(`/google-ads/campaigns?days=${days}`)).data as GoogleAdsCampaign[],
    enabled: statusData?.configured,
  });

  // Toggle campaign status
  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/google-ads/campaigns/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['google-ads-campaigns'] });
      qc.invalidateQueries({ queryKey: ['google-ads-summary'] });
    },
  });

  const isLoading = summaryLoading || campaignsLoading;

  if (!statusData?.configured) {
    return (
      <div className="p-6 flex items-center gap-3 text-yellow-600 bg-yellow-50 rounded-xl">
        <AlertCircle size={20} />
        <span>Google Ads לא מקושר. יש להגדיר GOOGLE_ADS_* בקובץ .env</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Google Ads</h1>
          {statusData.customerId && (
            <p className="text-sm text-gray-500 mt-0.5">
              Customer ID: {statusData.customerId}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="border rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value={7}>7 ימים</option>
            <option value={14}>14 ימים</option>
            <option value={30}>30 ימים</option>
            <option value={60}>60 ימים</option>
            <option value={90}>90 ימים</option>
          </select>
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="btn btn-outline btn-sm flex items-center gap-2"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            רענן
          </button>
          <a
            href="https://ads.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline btn-sm flex items-center gap-2"
          >
            <ExternalLink size={14} />
            Google Ads
          </a>
        </div>
      </div>

      {/* Summary KPI cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            icon={<TrendingUp size={20} className="text-blue-600" />}
            label="חשיפות"
            value={formatNum(summary.impressions)}
            bg="bg-blue-50"
          />
          <KpiCard
            icon={<MousePointerClick size={20} className="text-green-600" />}
            label="קליקים"
            value={formatNum(summary.clicks)}
            sub={`CTR ${summary.ctr}%`}
            bg="bg-green-50"
          />
          <KpiCard
            icon={<DollarSign size={20} className="text-orange-600" />}
            label="הוצאה"
            value={formatCost(summary.cost)}
            sub={`CPC ממוצע $${summary.avgCpc}`}
            bg="bg-orange-50"
          />
          <KpiCard
            icon={<Target size={20} className="text-purple-600" />}
            label="המרות"
            value={String(summary.conversions)}
            sub={summary.costPerConversion ? `$${summary.costPerConversion} לליד` : undefined}
            bg="bg-purple-50"
          />
        </div>
      )}

      {/* Campaigns table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">קמפיינים ({campaigns.length})</h2>
        </div>

        {campaignsLoading ? (
          <div className="p-12 text-center text-gray-400">טוען נתונים...</div>
        ) : campaigns.length === 0 ? (
          <div className="p-12 text-center text-gray-400">לא נמצאו קמפיינים</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-right">
                  <th className="px-4 py-3">שם קמפיין</th>
                  <th className="px-4 py-3">סטטוס</th>
                  <th className="px-4 py-3">סוג</th>
                  <th className="px-4 py-3 text-left">חשיפות</th>
                  <th className="px-4 py-3 text-left">קליקים</th>
                  <th className="px-4 py-3 text-left">CTR</th>
                  <th className="px-4 py-3 text-left">הוצאה</th>
                  <th className="px-4 py-3 text-left">CPC</th>
                  <th className="px-4 py-3 text-left">המרות</th>
                  <th className="px-4 py-3 text-left">עלות/המרה</th>
                  <th className="px-4 py-3">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campaigns.map(campaign => (
                  <tr key={campaign.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate">
                      {campaign.name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          campaign.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            campaign.status === 'active' ? 'bg-green-500' : 'bg-gray-400'
                          }`}
                        />
                        {campaign.status === 'active' ? 'פעיל' : 'מושהה'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {CHANNEL_LABEL[campaign.channelType] || campaign.channelType}
                    </td>
                    <td className="px-4 py-3 text-left text-gray-700">{formatNum(campaign.impressions)}</td>
                    <td className="px-4 py-3 text-left text-gray-700">{formatNum(campaign.clicks)}</td>
                    <td className="px-4 py-3 text-left text-gray-700">{campaign.ctr}%</td>
                    <td className="px-4 py-3 text-left font-medium text-gray-900">{formatCost(campaign.cost)}</td>
                    <td className="px-4 py-3 text-left text-gray-700">${campaign.avgCpc}</td>
                    <td className="px-4 py-3 text-left text-gray-700">{campaign.conversions}</td>
                    <td className="px-4 py-3 text-left text-gray-700">
                      {campaign.costPerConversion ? formatCost(campaign.costPerConversion) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          toggleStatus.mutate({
                            id: campaign.id,
                            status: campaign.status === 'active' ? 'paused' : 'active',
                          })
                        }
                        disabled={toggleStatus.isPending}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          campaign.status === 'active'
                            ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                            : 'bg-green-100 hover:bg-green-200 text-green-700'
                        }`}
                        title={campaign.status === 'active' ? 'השהה קמפיין' : 'הפעל קמפיין'}
                      >
                        {campaign.status === 'active' ? (
                          <><Pause size={12} /> השהה</>
                        ) : (
                          <><Play size={12} /> הפעל</>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon,
  label,
  value,
  sub,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  bg: string;
}) {
  return (
    <div className={`${bg} rounded-xl p-4 border border-white/60 shadow-sm`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-gray-600">{label}</span></div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}
