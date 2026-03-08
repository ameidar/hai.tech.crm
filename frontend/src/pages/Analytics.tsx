import { useState, useEffect } from 'react';

import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { TrendingUp, Users, Eye, Globe, Monitor, RefreshCw, ExternalLink, MapPin, Wifi } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const DAYS_OPTIONS = [
  { label: '7 ימים', value: 7 },
  { label: '30 ימים', value: 30 },
  { label: '90 ימים', value: 90 },
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function fmtNum(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function fmtDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(d: string) {
  const [, m, day] = d.split('-');
  return `${day}/${m}`;
}

export default function Analytics() {
  const token = localStorage.getItem('accessToken');
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [traffic, setTraffic] = useState<any>(null);
  const [topPages, setTopPages] = useState<any>(null);
  const [devices, setDevices] = useState<any>(null);
  const [geo, setGeo] = useState<any>(null);
  const [geoDimension, setGeoDimension] = useState<'city' | 'region' | 'country'>('city');
  const [realtime, setRealtime] = useState<{ activeUsers: number; byPage: { path: string; users: number }[] }>({ activeUsers: 0, byPage: [] });
  const [realtimeLoading, setRealtimeLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = async () => {
    setLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [ov, tr, tp, dv, gv] = await Promise.all([
        fetch(`${API_BASE}/analytics/overview?days=${days}`, { headers }).then(r => r.json()),
        fetch(`${API_BASE}/analytics/traffic-sources?days=${days}`, { headers }).then(r => r.json()),
        fetch(`${API_BASE}/analytics/top-pages?days=${days}&limit=10`, { headers }).then(r => r.json()),
        fetch(`${API_BASE}/analytics/devices?days=${days}`, { headers }).then(r => r.json()),
        fetch(`${API_BASE}/analytics/geo?days=${days}&dimension=${geoDimension}&limit=15`, { headers }).then(r => r.json()),
      ]);
      if (ov.error) throw new Error(ov.error);
      setOverview(ov);
      setTraffic(tr);
      setTopPages(tp);
      setDevices(dv);
      setGeo(gv);
    } catch (e: any) {
      setError(e.message || 'שגיאה בטעינת נתוני Analytics');
    } finally {
      setLoading(false);
    }
  };

  const fetchGeo = async (dim: 'city' | 'region' | 'country') => {
    setGeoDimension(dim);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const gv = await fetch(`${API_BASE}/analytics/geo?days=${days}&dimension=${dim}&limit=15`, { headers }).then(r => r.json());
      setGeo(gv);
    } catch {}
  };

  useEffect(() => { fetchAll(); }, [days]);

  // Realtime auto-refresh every 30 seconds
  useEffect(() => {
    const fetchRealtime = async () => {
      try {
        const res = await fetch(`${API_BASE}/analytics/realtime`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.error) setRealtime(data);
      } catch {}
      finally { setRealtimeLoading(false); }
    };
    fetchRealtime();
    const interval = setInterval(fetchRealtime, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp size={28} className="text-blue-500" />
            Google Analytics
          </h1>
          <p className="text-gray-500 text-sm mt-1">נתוני תנועה ל-<a href="https://hai.tech" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-1">hai.tech <ExternalLink size={12} /></a></p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {DAYS_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => setDays(o.value)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  days === o.value ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="btn btn-outline btn-sm flex items-center gap-2"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            רענן
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error mb-6">
          <span>⚠️ {error}</span>
          {error.includes('permission') || error.includes('Permission') ? (
            <a
              href="https://analytics.google.com/analytics/web/#/p399485645/admin/propertyaccess"
              target="_blank" rel="noopener noreferrer"
              className="underline text-sm mr-2"
            >
              הוסף הרשאות ב-GA4
            </a>
          ) : null}
        </div>
      )}

      {loading && !overview ? (
        <div className="flex items-center justify-center h-64">
          <div className="loading loading-spinner loading-lg text-blue-500" />
        </div>
      ) : overview && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard icon={<TrendingUp size={20} className="text-blue-500" />} label="סשנים" value={fmtNum(overview.totals.sessions)} bg="bg-blue-50" />
            <StatCard icon={<Users size={20} className="text-green-500" />} label="משתמשים" value={fmtNum(overview.totals.users)} bg="bg-green-50" />
            <StatCard icon={<Eye size={20} className="text-purple-500" />} label="צפיות עמוד" value={fmtNum(overview.totals.pageviews)} bg="bg-purple-50" />
            <StatCard
              icon={<Globe size={20} className="text-orange-500" />}
              label="עמודים לסשן"
              value={overview.totals.sessions > 0 ? (overview.totals.pageviews / overview.totals.sessions).toFixed(1) : '0'}
              bg="bg-orange-50"
            />
          </div>

          {/* Realtime card */}
          {(
            <div className="card bg-base-100 shadow-sm border border-base-200 p-5 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
                      <Wifi size={28} className="text-green-500" />
                    </div>
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-400 animate-ping" />
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">אונליין עכשיו</p>
                    <p className="text-4xl font-bold text-green-600">
                      {realtimeLoading ? <span className="text-2xl text-gray-400">...</span> : realtime.activeUsers}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">משתמשים פעילים ב-60 דקות האחרונות • מתעדכן כל 30 שניות</p>
                  </div>
                </div>
                {realtime.byPage?.length > 0 && (
                  <div className="border-r border-gray-200 pr-6 mr-2 hidden md:block">
                    <p className="text-xs font-semibold text-gray-500 mb-2">עמודים פעילים:</p>
                    <div className="space-y-1">
                      {realtime.byPage.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 text-xs flex items-center justify-center font-bold">{p.users}</span>
                          <a
                            href={`https://hai.tech${p.path}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-600 hover:text-blue-600 font-mono text-xs"
                          >
                            {p.path.length > 35 ? p.path.slice(0, 35) + '…' : p.path}
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sessions over time */}
          <div className="card bg-base-100 shadow-sm border border-base-200 p-5 mb-6">
            <h2 className="font-semibold text-gray-700 mb-4">📈 סשנים ומשתמשים לאורך זמן</h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={overview.rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(l) => `תאריך: ${l}`}
                  formatter={(v: any, name: string | undefined) => [v, name === 'sessions' ? 'סשנים' : 'משתמשים']}
                />
                <Legend formatter={(v: string) => v === 'sessions' ? 'סשנים' : 'משתמשים'} />
                <Line type="monotone" dataKey="sessions" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="users" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Traffic Sources */}
            {traffic?.rows?.length > 0 && (
              <div className="card bg-base-100 shadow-sm border border-base-200 p-5">
                <h2 className="font-semibold text-gray-700 mb-4">🌐 מקורות תנועה</h2>
                <div className="flex gap-4 items-center">
                  <ResponsiveContainer width="50%" height={180}>
                    <PieChart>
                      <Pie
                        data={traffic.rows}
                        dataKey="sessions"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label={false}
                      >
                        {traffic.rows.map((_: any, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => [`${v} סשנים`]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5">
                    {traffic.rows.map((r: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="text-gray-700">{r.label}</span>
                        </div>
                        <span className="font-medium">{r.sessions}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Devices */}
            {devices?.rows?.length > 0 && (
              <div className="card bg-base-100 shadow-sm border border-base-200 p-5">
                <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <Monitor size={18} /> סוגי מכשירים
                </h2>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={devices.rows} layout="vertical" margin={{ right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="label" type="category" tick={{ fontSize: 12 }} width={100} />
                    <Tooltip formatter={(v: any) => [`${v} סשנים`]} />
                    <Bar dataKey="sessions" radius={[0, 4, 4, 0]}>
                      {devices.rows.map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Geo breakdown */}
          {geo?.rows?.length > 0 && (
            <div className="card bg-base-100 shadow-sm border border-base-200 p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-700 flex items-center gap-2">
                  <MapPin size={18} className="text-blue-500" /> גיאוגרפיה
                </h2>
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                  {([['city', 'עיר'], ['region', 'אזור'], ['country', 'מדינה']] as const).map(([dim, label]) => (
                    <button
                      key={dim}
                      onClick={() => fetchGeo(dim)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                        geoDimension === dim ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-6">
                <ResponsiveContainer width="55%" height={220}>
                  <BarChart data={geo.rows.slice(0, 10)} layout="vertical" margin={{ right: 20, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={90} />
                    <Tooltip formatter={(v: any) => [`${v} סשנים`]} />
                    <Bar dataKey="sessions" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex-1 overflow-auto max-h-[220px]">
                  <table className="table table-xs w-full">
                    <thead>
                      <tr className="text-right">
                        <th>#</th>
                        <th>{geoDimension === 'city' ? 'עיר' : geoDimension === 'region' ? 'אזור' : 'מדינה'}</th>
                        <th className="text-center">סשנים</th>
                        <th className="text-center">משתמשים</th>
                      </tr>
                    </thead>
                    <tbody>
                      {geo.rows.map((r: any, i: number) => (
                        <tr key={i} className="hover">
                          <td className="text-gray-400">{i + 1}</td>
                          <td className="font-medium text-sm">{r.name}</td>
                          <td className="text-center">{r.sessions}</td>
                          <td className="text-center text-gray-500">{r.users}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Top Pages */}
          {topPages?.rows?.length > 0 && (
            <div className="card bg-base-100 shadow-sm border border-base-200 p-5">
              <h2 className="font-semibold text-gray-700 mb-4">📄 עמודים פופולריים</h2>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr className="text-right">
                      <th>#</th>
                      <th>נתיב</th>
                      <th>כותרת</th>
                      <th className="text-center">צפיות</th>
                      <th className="text-center">משתמשים</th>
                      <th className="text-center">זמן ממוצע</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPages.rows.map((p: any, i: number) => (
                      <tr key={i} className="hover">
                        <td className="text-gray-400 text-sm">{i + 1}</td>
                        <td>
                          <a
                            href={`https://hai.tech${p.path}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline font-mono text-sm flex items-center gap-1"
                          >
                            {p.path.length > 40 ? p.path.slice(0, 40) + '…' : p.path}
                            <ExternalLink size={11} />
                          </a>
                        </td>
                        <td className="text-sm text-gray-600">{p.title?.slice(0, 50) || '—'}</td>
                        <td className="text-center font-medium">{fmtNum(p.pageviews)}</td>
                        <td className="text-center text-gray-600">{fmtNum(p.users)}</td>
                        <td className="text-center text-gray-600">{fmtDuration(p.avgDuration)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-4 flex items-center gap-3`}>
      <div className="p-2 bg-white rounded-lg shadow-sm">{icon}</div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-800">{value}</p>
      </div>
    </div>
  );
}
