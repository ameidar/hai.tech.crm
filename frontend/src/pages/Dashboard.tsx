import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  Users,
  RefreshCcw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Activity,
  ChevronLeft,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useMeetings, useCyclesWithTotal, useCustomers, useInstructors, useRecalculateMeeting } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import MeetingDetailModal from '../components/MeetingDetailModal';
import { meetingStatusHebrew, dayOfWeekHebrew } from '../types';
import type { Meeting, MeetingStatus } from '../types';

// Mock data for monthly revenue chart (in a real app, this would come from API)
const monthlyRevenueData = [
  { month: 'ינואר', revenue: 45000, costs: 28000 },
  { month: 'פברואר', revenue: 52000, costs: 31000 },
  { month: 'מרץ', revenue: 48000, costs: 29000 },
  { month: 'אפריל', revenue: 61000, costs: 35000 },
  { month: 'מאי', revenue: 55000, costs: 32000 },
  { month: 'יוני', revenue: 67000, costs: 38000 },
];

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const today = new Date().toISOString().split('T')[0];
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

  const { data: todayMeetings, isLoading: loadingMeetings } = useMeetings({ date: today });
  const { data: cyclesData, isLoading: loadingCycles } = useCyclesWithTotal({ status: 'active' });
  const cycles = cyclesData?.data;
  const cyclesTotal = cyclesData?.pagination?.total;
  const { data: customers, isLoading: loadingCustomers } = useCustomers();
  const { data: instructors, isLoading: loadingInstructors } = useInstructors();
  const recalculateMeeting = useRecalculateMeeting();

  const stats = useMemo(() => {
    if (!todayMeetings) return null;

    const completed = todayMeetings.filter((m) => m.status === 'completed').length;
    const cancelled = todayMeetings.filter((m) => m.status === 'cancelled').length;
    const pending = todayMeetings.filter((m) => m.status === 'scheduled').length;
    const totalRevenue = todayMeetings
      .filter((m) => m.status === 'completed')
      .reduce((sum, m) => sum + Number(m.revenue || 0), 0);
    const totalCosts = todayMeetings
      .filter((m) => m.status === 'completed')
      .reduce((sum, m) => sum + Number(m.instructorPayment || 0), 0);

    return {
      total: todayMeetings.length,
      completed,
      cancelled,
      pending,
      totalRevenue,
      totalCosts,
      profit: totalRevenue - totalCosts,
    };
  }, [todayMeetings]);

  const isLoading = loadingMeetings || loadingCycles || loadingCustomers || loadingInstructors;

  const getStatusConfig = (status: MeetingStatus) => {
    switch (status) {
      case 'completed':
        return { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' };
      case 'cancelled':
        return { bg: 'bg-rose-100', text: 'text-rose-700', dot: 'bg-rose-500' };
      case 'postponed':
        return { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' };
      default:
        return { bg: 'bg-sky-100', text: 'text-sky-700', dot: 'bg-sky-500' };
    }
  };

  const formatTime = (time: string) => {
    if (time.includes('T')) {
      const date = new Date(time);
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    return time.substring(0, 5);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('he-IL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleRecalculate = async (meetingId: string) => {
    try {
      const result = await recalculateMeeting.mutateAsync(meetingId);
      if (selectedMeeting) {
        setSelectedMeeting({ ...selectedMeeting, ...result });
      }
    } catch (error) {
      console.error('Failed to recalculate meeting:', error);
      alert('שגיאה בחישוב מחדש');
    }
  };

  // Custom tooltip for the chart
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white/95 backdrop-blur-sm p-4 rounded-xl shadow-lg border border-gray-100">
          <p className="font-semibold text-gray-900 mb-2">{label}</p>
          <p className="text-emerald-600 text-sm">
            הכנסות: ₪{payload[0]?.value?.toLocaleString()}
          </p>
          <p className="text-rose-500 text-sm">
            עלויות: ₪{payload[1]?.value?.toLocaleString()}
          </p>
          <p className="text-gray-700 text-sm font-medium mt-1 pt-1 border-t">
            רווח: ₪{(payload[0]?.value - payload[1]?.value)?.toLocaleString()}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <>
      <PageHeader
        title="דשבורד"
        subtitle={formatDate(today)}
      />

      <div className="flex-1 p-6 overflow-auto bg-gradient-to-br from-gray-50 to-gray-100/50">
        {isLoading ? (
          <Loading size="lg" text="טוען נתונים..." />
        ) : (
          <div className="space-y-6">
            {/* KPI Cards with Gradients */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <KPICard
                title="מחזורים פעילים"
                value={cyclesTotal || cycles?.length || 0}
                icon={<RefreshCcw size={24} />}
                gradient="from-blue-500 to-blue-600"
                lightGradient="from-blue-50 to-blue-100"
                trend="+12%"
                trendUp={true}
              />
              <KPICard
                title="לקוחות"
                value={customers?.length || 0}
                icon={<Users size={24} />}
                gradient="from-emerald-500 to-teal-600"
                lightGradient="from-emerald-50 to-teal-100"
                trend="+8%"
                trendUp={true}
              />
              <KPICard
                title="מדריכים פעילים"
                value={instructors?.filter((i) => i.isActive).length || 0}
                icon={<Activity size={24} />}
                gradient="from-violet-500 to-purple-600"
                lightGradient="from-violet-50 to-purple-100"
                trend="+3"
                trendUp={true}
              />
              <KPICard
                title="פגישות היום"
                value={stats?.total || 0}
                icon={<Calendar size={24} />}
                gradient="from-orange-500 to-amber-500"
                lightGradient="from-orange-50 to-amber-100"
                subtext={stats ? `${stats.completed} הושלמו` : undefined}
              />
            </div>

            {/* Today's Financial Summary */}
            {stats && stats.total > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FinancialCard
                  title="הכנסות היום"
                  value={stats.totalRevenue}
                  icon={<DollarSign size={24} />}
                  gradient="from-emerald-400 to-emerald-600"
                  positive={true}
                />
                <FinancialCard
                  title="עלויות מדריכים"
                  value={stats.totalCosts}
                  icon={<Wallet size={24} />}
                  gradient="from-rose-400 to-rose-600"
                  positive={false}
                />
                <FinancialCard
                  title="רווח נקי"
                  value={stats.profit}
                  icon={stats.profit >= 0 ? <TrendingUp size={24} /> : <TrendingDown size={24} />}
                  gradient={stats.profit >= 0 ? 'from-blue-400 to-indigo-600' : 'from-rose-400 to-rose-600'}
                  positive={stats.profit >= 0}
                  showSign={true}
                />
              </div>
            )}

            {/* Monthly Revenue Chart */}
            <div className="card overflow-hidden">
              <div className="card-header bg-gradient-to-l from-gray-50 to-white border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">מגמת הכנסות חודשית</h2>
                    <p className="text-sm text-gray-500 mt-1">השוואת הכנסות ועלויות</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-emerald-500" />
                      הכנסות
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-rose-400" />
                      עלויות
                    </span>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <div className="h-80" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={monthlyRevenueData}
                      margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorCosts" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="month" 
                        stroke="#9ca3af"
                        tick={{ fill: '#6b7280', fontSize: 12 }}
                      />
                      <YAxis 
                        stroke="#9ca3af"
                        tick={{ fill: '#6b7280', fontSize: 12 }}
                        tickFormatter={(value) => `₪${(value / 1000).toFixed(0)}K`}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#10b981"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorRevenue)"
                      />
                      <Area
                        type="monotone"
                        dataKey="costs"
                        stroke="#f43f5e"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorCosts)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Today's Meetings - Enhanced Table */}
            <div className="card overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="card-header bg-gradient-to-l from-sky-50 to-white border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-sky-100 rounded-lg">
                      <Calendar size={20} className="text-sky-600" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">פגישות היום</h2>
                      <p className="text-sm text-gray-500">
                        {stats ? `${stats.total} פגישות מתוכננות` : 'טוען...'}
                      </p>
                    </div>
                  </div>
                  {stats && (
                    <div className="flex items-center gap-3 text-sm">
                      <StatusBadge color="emerald" count={stats.completed} label="הושלמו" />
                      <StatusBadge color="sky" count={stats.pending} label="ממתינים" />
                      <StatusBadge color="rose" count={stats.cancelled} label="בוטלו" />
                    </div>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                {todayMeetings && todayMeetings.length > 0 ? (
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50/80">
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          שעה
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          מחזור
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          מדריך
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          סניף
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          סטטוס
                        </th>
                        <th className="px-6 py-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {todayMeetings
                        .sort((a, b) => a.startTime.localeCompare(b.startTime))
                        .map((meeting, index) => {
                          const statusConfig = getStatusConfig(meeting.status);
                          return (
                            <tr
                              key={meeting.id}
                              onClick={() => setSelectedMeeting(meeting)}
                              className="cursor-pointer hover:bg-gradient-to-l hover:from-blue-50 hover:to-transparent transition-all duration-200 group"
                              style={{ animationDelay: `${index * 50}ms` }}
                            >
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                                  <span className="font-semibold text-gray-900">
                                    {formatTime(meeting.startTime)}
                                  </span>
                                  <span className="text-gray-400">-</span>
                                  <span className="text-gray-600">
                                    {formatTime(meeting.endTime)}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <Link
                                  to={`/cycles/${meeting.cycleId}`}
                                  className="text-blue-600 hover:text-blue-800 font-medium hover:underline underline-offset-2 transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {meeting.cycle?.name || '-'}
                                </Link>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-gray-700 font-medium">
                                  {meeting.instructor?.name || '-'}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-gray-600">
                                  {meeting.cycle?.branch?.name || '-'}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.text} transition-transform hover:scale-105`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
                                  {meetingStatusHebrew[meeting.status]}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <ChevronLeft 
                                  size={20} 
                                  className="text-gray-400 group-hover:text-blue-500 group-hover:translate-x-[-4px] transition-all duration-200" 
                                />
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-12 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                      <Calendar size={32} className="text-gray-400" />
                    </div>
                    <p className="text-gray-500 font-medium">אין פגישות מתוכננות להיום</p>
                    <p className="text-gray-400 text-sm mt-1">הפגישות הבאות יופיעו כאן</p>
                  </div>
                )}
              </div>
            </div>

            {/* Active Cycles - Enhanced */}
            <div className="card overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="card-header bg-gradient-to-l from-violet-50 to-white border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-violet-100 rounded-lg">
                      <RefreshCcw size={20} className="text-violet-600" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">מחזורים פעילים</h2>
                      <p className="text-sm text-gray-500">
                        {cyclesTotal || cycles?.length || 0} מחזורים בתהליך
                      </p>
                    </div>
                  </div>
                  <Link 
                    to="/cycles" 
                    className="inline-flex items-center gap-1 text-violet-600 hover:text-violet-800 text-sm font-medium hover:underline underline-offset-2 transition-colors"
                  >
                    צפייה בכל המחזורים
                    <ChevronLeft size={16} />
                  </Link>
                </div>
              </div>
              <div className="overflow-x-auto">
                {cycles && cycles.length > 0 ? (
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50/80">
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          שם המחזור
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          קורס
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          מדריך
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          יום
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          שעה
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          התקדמות
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {cycles.slice(0, 5).map((cycle, index) => {
                        const progress = (cycle.completedMeetings / cycle.totalMeetings) * 100;
                        return (
                          <tr 
                            key={cycle.id}
                            className="hover:bg-gradient-to-l hover:from-violet-50 hover:to-transparent transition-all duration-200"
                            style={{ animationDelay: `${index * 50}ms` }}
                          >
                            <td className="px-6 py-4">
                              <Link
                                to={`/cycles/${cycle.id}`}
                                className="text-violet-600 hover:text-violet-800 font-semibold hover:underline underline-offset-2 transition-colors"
                              >
                                {cycle.name}
                              </Link>
                            </td>
                            <td className="px-6 py-4 text-gray-700">
                              {cycle.course?.name || '-'}
                            </td>
                            <td className="px-6 py-4 text-gray-700 font-medium">
                              {cycle.instructor?.name || '-'}
                            </td>
                            <td className="px-6 py-4">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium">
                                {dayOfWeekHebrew[cycle.dayOfWeek]}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-gray-600 font-mono">
                              {formatTime(cycle.startTime)}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden min-w-[100px]">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-l from-violet-500 to-purple-600 transition-all duration-500 ease-out"
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                <span className="text-sm text-gray-600 font-medium whitespace-nowrap">
                                  {cycle.completedMeetings}/{cycle.totalMeetings}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-12 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                      <RefreshCcw size={32} className="text-gray-400" />
                    </div>
                    <p className="text-gray-500 font-medium">אין מחזורים פעילים</p>
                    <p className="text-gray-400 text-sm mt-1">מחזורים חדשים יופיעו כאן</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Meeting Detail Modal */}
      <MeetingDetailModal
        meeting={selectedMeeting}
        onClose={() => setSelectedMeeting(null)}
        onRecalculate={handleRecalculate}
        isRecalculating={recalculateMeeting.isPending}
        isAdmin={isAdmin}
      />
    </>
  );
}

// Enhanced KPI Card Component
interface KPICardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  gradient: string;
  lightGradient: string;
  trend?: string;
  trendUp?: boolean;
  subtext?: string;
}

function KPICard({ title, value, icon, gradient, lightGradient, trend, trendUp, subtext }: KPICardProps) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${lightGradient} p-6 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg group`}>
      {/* Background decoration */}
      <div className={`absolute -left-4 -top-4 w-24 h-24 rounded-full bg-gradient-to-br ${gradient} opacity-10 blur-2xl group-hover:opacity-20 transition-opacity duration-300`} />
      
      <div className="relative flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-3xl font-bold text-gray-900 tracking-tight">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {trend && (
            <div className={`inline-flex items-center gap-1 text-xs font-semibold ${trendUp ? 'text-emerald-600' : 'text-rose-600'}`}>
              {trendUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {trend}
            </div>
          )}
          {subtext && (
            <p className="text-sm text-gray-500">{subtext}</p>
          )}
        </div>
        <div className={`p-3 rounded-xl bg-gradient-to-br ${gradient} text-white shadow-lg transform group-hover:scale-110 transition-transform duration-300`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

// Financial Summary Card
interface FinancialCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  gradient: string;
  positive: boolean;
  showSign?: boolean;
}

function FinancialCard({ title, value, icon, gradient, positive, showSign }: FinancialCardProps) {
  const displayValue = showSign 
    ? `${value >= 0 ? '+' : ''}₪${Math.abs(value).toLocaleString()}`
    : `₪${value.toLocaleString()}`;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm hover:shadow-md transition-all duration-300 group border border-gray-100">
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`} />
      
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${positive ? 'text-gray-900' : 'text-rose-600'}`}>
            {displayValue}
          </p>
        </div>
        <div className={`p-3 rounded-xl bg-gradient-to-br ${gradient} text-white shadow-md transform group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

// Status Badge Component
interface StatusBadgeProps {
  color: 'emerald' | 'sky' | 'rose';
  count: number;
  label: string;
}

function StatusBadge({ color, count, label }: StatusBadgeProps) {
  const colorClasses = {
    emerald: 'bg-emerald-100 text-emerald-700',
    sky: 'bg-sky-100 text-sky-700',
    rose: 'bg-rose-100 text-rose-700',
  };

  const dotClasses = {
    emerald: 'bg-emerald-500',
    sky: 'bg-sky-500',
    rose: 'bg-rose-500',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${colorClasses[color]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotClasses[color]}`} />
      {count} {label}
    </span>
  );
}
