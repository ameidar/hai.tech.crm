import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  Users,
  RefreshCcw,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { useMeetings, useCycles, useCustomers, useInstructors } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import { meetingStatusHebrew, dayOfWeekHebrew } from '../types';
import type { Meeting, MeetingStatus } from '../types';

export default function Dashboard() {
  const today = new Date().toISOString().split('T')[0];

  const { data: todayMeetings, isLoading: loadingMeetings } = useMeetings({ date: today });
  const { data: cycles, isLoading: loadingCycles } = useCycles({ status: 'active' });
  const { data: customers, isLoading: loadingCustomers } = useCustomers();
  const { data: instructors, isLoading: loadingInstructors } = useInstructors();

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

  const getStatusIcon = (status: MeetingStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="text-green-500" size={18} />;
      case 'cancelled':
        return <XCircle className="text-red-500" size={18} />;
      case 'postponed':
        return <AlertCircle className="text-yellow-500" size={18} />;
      default:
        return <Clock className="text-blue-500" size={18} />;
    }
  };

  const getStatusBadgeClass = (status: MeetingStatus) => {
    switch (status) {
      case 'completed':
        return 'badge-success';
      case 'cancelled':
        return 'badge-danger';
      case 'postponed':
        return 'badge-warning';
      default:
        return 'badge-info';
    }
  };

  const formatTime = (time: string) => {
    // Handle ISO date format (1970-01-01T16:00:00.000Z) or simple time (16:00)
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

  return (
    <>
      <PageHeader
        title="דשבורד"
        subtitle={formatDate(today)}
      />

      <div className="flex-1 p-6 overflow-auto">
        {isLoading ? (
          <Loading size="lg" text="טוען נתונים..." />
        ) : (
          <div className="space-y-6">
            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard
                title="מחזורים פעילים"
                value={cycles?.length || 0}
                icon={<RefreshCcw size={24} />}
                color="blue"
              />
              <StatCard
                title="לקוחות"
                value={customers?.length || 0}
                icon={<Users size={24} />}
                color="green"
              />
              <StatCard
                title="מדריכים"
                value={instructors?.filter((i) => i.isActive).length || 0}
                icon={<Users size={24} />}
                color="purple"
              />
              <StatCard
                title="פגישות היום"
                value={stats?.total || 0}
                icon={<Calendar size={24} />}
                color="orange"
              />
            </div>

            {/* Today's Summary */}
            {stats && stats.total > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card card-body">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">הכנסות היום</p>
                      <p className="text-2xl font-bold text-gray-900">
                        ₪{stats.totalRevenue.toLocaleString()}
                      </p>
                    </div>
                    <div className="p-3 bg-green-100 rounded-full">
                      <TrendingUp className="text-green-600" size={24} />
                    </div>
                  </div>
                </div>

                <div className="card card-body">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">עלויות מדריכים</p>
                      <p className="text-2xl font-bold text-gray-900">
                        ₪{stats.totalCosts.toLocaleString()}
                      </p>
                    </div>
                    <div className="p-3 bg-red-100 rounded-full">
                      <TrendingDown className="text-red-600" size={24} />
                    </div>
                  </div>
                </div>

                <div className="card card-body">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">רווח</p>
                      <p className={`text-2xl font-bold ${stats.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ₪{stats.profit.toLocaleString()}
                      </p>
                    </div>
                    <div className={`p-3 rounded-full ${stats.profit >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                      {stats.profit >= 0 ? (
                        <TrendingUp className="text-green-600" size={24} />
                      ) : (
                        <TrendingDown className="text-red-600" size={24} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Today's Meetings */}
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h2 className="text-lg font-semibold">פגישות היום</h2>
                {stats && (
                  <div className="flex items-center gap-4 text-sm">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      {stats.completed} הושלמו
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      {stats.pending} ממתינים
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      {stats.cancelled} בוטלו
                    </span>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                {todayMeetings && todayMeetings.length > 0 ? (
                  <table>
                    <thead>
                      <tr>
                        <th>שעה</th>
                        <th>מחזור</th>
                        <th>מדריך</th>
                        <th>סניף</th>
                        <th>סטטוס</th>
                        <th>פעולות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todayMeetings
                        .sort((a, b) => a.startTime.localeCompare(b.startTime))
                        .map((meeting) => (
                          <tr key={meeting.id}>
                            <td className="font-medium">
                              {formatTime(meeting.startTime)} - {formatTime(meeting.endTime)}
                            </td>
                            <td>
                              <Link
                                to={`/cycles/${meeting.cycleId}`}
                                className="text-blue-600 hover:underline"
                              >
                                {meeting.cycle?.name || '-'}
                              </Link>
                            </td>
                            <td>{meeting.instructor?.name || '-'}</td>
                            <td>{meeting.cycle?.branch?.name || '-'}</td>
                            <td>
                              <span className={`badge ${getStatusBadgeClass(meeting.status)}`}>
                                {meetingStatusHebrew[meeting.status]}
                              </span>
                            </td>
                            <td>
                              <Link
                                to={`/meetings/${meeting.id}`}
                                className="text-blue-600 hover:underline text-sm"
                              >
                                צפייה
                              </Link>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center text-gray-500">
                    <Calendar size={48} className="mx-auto mb-4 text-gray-300" />
                    <p>אין פגישות מתוכננות להיום</p>
                  </div>
                )}
              </div>
            </div>

            {/* Active Cycles Quick View */}
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h2 className="text-lg font-semibold">מחזורים פעילים</h2>
                <Link to="/cycles" className="text-blue-600 hover:underline text-sm">
                  צפייה בכל המחזורים
                </Link>
              </div>
              <div className="overflow-x-auto">
                {cycles && cycles.length > 0 ? (
                  <table>
                    <thead>
                      <tr>
                        <th>שם המחזור</th>
                        <th>קורס</th>
                        <th>מדריך</th>
                        <th>יום</th>
                        <th>שעה</th>
                        <th>התקדמות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cycles.slice(0, 5).map((cycle) => (
                        <tr key={cycle.id}>
                          <td>
                            <Link
                              to={`/cycles/${cycle.id}`}
                              className="text-blue-600 hover:underline font-medium"
                            >
                              {cycle.name}
                            </Link>
                          </td>
                          <td>{cycle.course?.name || '-'}</td>
                          <td>{cycle.instructor?.name || '-'}</td>
                          <td>{dayOfWeekHebrew[cycle.dayOfWeek]}</td>
                          <td>{formatTime(cycle.startTime)}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-600 rounded-full"
                                  style={{
                                    width: `${(cycle.completedMeetings / cycle.totalMeetings) * 100}%`,
                                  }}
                                />
                              </div>
                              <span className="text-sm text-gray-500">
                                {cycle.completedMeetings}/{cycle.totalMeetings}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center text-gray-500">
                    <RefreshCcw size={48} className="mx-auto mb-4 text-gray-300" />
                    <p>אין מחזורים פעילים</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// Stat Card Component
interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple' | 'orange' | 'red';
}

function StatCard({ title, value, icon, color }: StatCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
    red: 'bg-red-50 text-red-600',
  };

  return (
    <div className="card card-body">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-xl ${colorClasses[color]}`}>{icon}</div>
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
