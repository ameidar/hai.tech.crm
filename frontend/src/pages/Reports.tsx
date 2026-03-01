import { useState, useMemo, useEffect } from 'react';
import { BarChart3, Calendar, TrendingUp, DollarSign, Building2, FileText, Download, RefreshCw, CreditCard, Users, Send, FileSpreadsheet, Loader2 } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import { useMeetings, useCycles, useInstructors, useBranches } from '../hooks/useApi';

// ─── Instructor Report Types ───────────────────────────────────────────────────

interface InstructorReportSummary {
  instructorName: string;
  totalMeetings: number;
  totalHours: number;
  totalPayment: number;
  totalExpenses: number;
  grandTotal: number;
}
interface MonthOption { value: string; label: string; }

// ─── Instructor Report Tab ─────────────────────────────────────────────────────

function InstructorReportTab() {
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [loadingMonths, setLoadingMonths] = useState(false);
  const [report, setReport] = useState<{ monthLabel: string; instructors: InstructorReportSummary[]; summaryTotalPayment: number; summaryTotalExpenses: number; summaryGrandTotal: number } | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const token = () => localStorage.getItem('accessToken') || '';

  const fetchMonths = async () => {
    setLoadingMonths(true);
    try {
      const res = await fetch('/api/reports/instructors/months', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      setMonths(data.months || []);
      if (data.months?.length) setSelectedMonth(data.months[0].value);
    } catch { setMsg({ type: 'error', text: 'שגיאה בטעינת חודשים' }); }
    finally { setLoadingMonths(false); }
  };

  const loadReport = async () => {
    if (!selectedMonth) return;
    setLoadingReport(true);
    setReport(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/reports/instructors?month=${selectedMonth}`, { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReport(data);
    } catch (e: unknown) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'שגיאה' });
    } finally { setLoadingReport(false); }
  };

  const downloadExcel = async () => {
    if (!selectedMonth) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/reports/instructors/excel?month=${selectedMonth}`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) throw new Error('שגיאה בהורדה');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers.get('Content-Disposition') || '';
      const fn = decodeURIComponent(cd.split("filename*=UTF-8''")[1] || 'report.xlsx');
      a.download = fn;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'שגיאת הורדה' });
    } finally { setDownloading(false); }
  };

  const sendReport = async () => {
    if (!selectedMonth) return;
    setSending(true);
    setMsg(null);
    try {
      const res = await fetch('/api/reports/instructors/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'שגיאה');
      setMsg({ type: 'success', text: `✅ ${data.message}` });
    } catch (e: unknown) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'שגיאת שליחה' });
    } finally { setSending(false); }
  };

  // Auto-load months on first render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchMonths(); }, []);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-white rounded-lg shadow p-5">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users size={20} className="text-blue-600" />
          דוח פעילות מדריכים
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 font-medium">חודש:</label>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              disabled={loadingMonths}
              className="border rounded-lg px-3 py-2 text-sm min-w-[160px] focus:ring-2 focus:ring-blue-500"
            >
              {loadingMonths && <option>טוען...</option>}
              {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <button
            onClick={loadReport}
            disabled={!selectedMonth || loadingReport}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loadingReport ? <Loader2 size={15} className="animate-spin" /> : <BarChart3 size={15} />}
            הצג דוח
          </button>

          <button
            onClick={downloadExcel}
            disabled={!selectedMonth || downloading}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {downloading ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
            הורד Excel
          </button>

          <button
            onClick={sendReport}
            disabled={!selectedMonth || sending}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            שלח להילה / עמי / אינה
          </button>
        </div>

        {msg && (
          <div className={`mt-3 p-3 rounded-lg text-sm font-medium ${msg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.text}
          </div>
        )}

        <p className="mt-3 text-xs text-gray-400">
          📅 הדוח נשלח אוטומטית ב-1 לכל חודש בשעה 08:00 לגבי החודש הקודם.
          כאן ניתן לשלוח ידנית לפי בחירה.
        </p>
      </div>

      {/* Report preview */}
      {report && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b bg-blue-50 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-blue-900">
              📊 דוח {report.monthLabel}
            </h3>
            <button onClick={downloadExcel} disabled={downloading}
              className="flex items-center gap-1.5 text-sm text-blue-700 hover:text-blue-900 font-medium">
              <Download size={15} />
              הורד Excel
            </button>
          </div>

          {report.instructors.length === 0 ? (
            <div className="p-8 text-center text-gray-500">אין פגישות שהושלמו בחודש זה</div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-right p-3 font-medium text-gray-600 text-sm">מדריך</th>
                  <th className="text-center p-3 font-medium text-gray-600 text-sm">פגישות</th>
                  <th className="text-center p-3 font-medium text-gray-600 text-sm">שעות</th>
                  <th className="text-center p-3 font-medium text-gray-600 text-sm">תשלום</th>
                  <th className="text-center p-3 font-medium text-gray-600 text-sm">הוצאות נוספות</th>
                  <th className="text-center p-3 font-medium text-gray-600 text-sm font-bold">סה"כ לתשלום</th>
                </tr>
              </thead>
              <tbody>
                {report.instructors.map((instr, i) => (
                  <tr key={i} className="border-t hover:bg-blue-50 transition-colors">
                    <td className="p-3 font-semibold text-gray-800">{instr.instructorName}</td>
                    <td className="p-3 text-center text-gray-700">{instr.totalMeetings}</td>
                    <td className="p-3 text-center text-gray-700">{instr.totalHours.toFixed(1)}</td>
                    <td className="p-3 text-center text-gray-700">₪{instr.totalPayment.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</td>
                    <td className="p-3 text-center text-gray-500 text-sm">{instr.totalExpenses > 0 ? `₪${instr.totalExpenses.toLocaleString('he-IL', { minimumFractionDigits: 2 })}` : '—'}</td>
                    <td className="p-3 text-center font-bold text-blue-700">₪{instr.grandTotal.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-blue-100">
                <tr>
                  <td colSpan={3} className="p-3 font-bold text-blue-900">סה"כ כולל</td>
                  <td className="p-3 text-center font-bold text-blue-900">₪{report.summaryTotalPayment.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</td>
                  <td className="p-3 text-center font-bold text-blue-900">{report.summaryTotalExpenses > 0 ? `₪${report.summaryTotalExpenses.toLocaleString('he-IL', { minimumFractionDigits: 2 })}` : '—'}</td>
                  <td className="p-3 text-center font-bold text-blue-900 text-lg">₪{report.summaryGrandTotal.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const [syncStatus, setSyncStatus] = useState<{ loading: boolean; result?: string; error?: string }>({ loading: false });

  const syncWooPayments = async (days = 14) => {
    setSyncStatus({ loading: true });
    try {
      const token = localStorage.getItem('accessToken') || '';
      const res = await fetch(`/api/payments/sync-woo?days=${days}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setSyncStatus({ loading: false, result: `✅ ${data.created} חדשות, ${data.updated || 0} עודכנו עם חשבונית, ${data.skipped} ללא שינוי` });
      } else {
        setSyncStatus({ loading: false, error: data.error || 'שגיאה' });
      }
    } catch {
      setSyncStatus({ loading: false, error: 'שגיאת רשת' });
    }
    setTimeout(() => setSyncStatus({ loading: false }), 8000);
  };

  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return {
      from: startOfMonth.toISOString().split('T')[0],
      to: endOfMonth.toISOString().split('T')[0],
    };
  });
  const [branchFilter, setBranchFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'billing' | 'cycles' | 'instructors'>('overview');
  const [detailBranchId, setDetailBranchId] = useState<string | null>(null);
  const [cyclesLimit, setCyclesLimit] = useState(20);

  const { data: branches, isLoading: loadingBranches } = useBranches();
  const { data: meetings, isLoading: loadingMeetings } = useMeetings({
    from: dateRange.from,
    to: dateRange.to,
    branchId: branchFilter || undefined,
  });
  const { data: cycles, isLoading: loadingCycles } = useCycles({ 
    status: 'active',
    branchId: branchFilter || undefined,
    limit: cyclesLimit,
  });
  const { data: instructors, isLoading: loadingInstructors } = useInstructors();

  const stats = useMemo(() => {
    if (!meetings || !Array.isArray(meetings)) {
      return {
        totalMeetings: 0,
        completedMeetings: 0,
        cancelledMeetings: 0,
        totalRevenue: 0,
        totalCosts: 0,
        profit: 0,
      };
    }

    const completed = meetings.filter((m) => m.status === 'completed');
    const cancelled = meetings.filter((m) => m.status === 'cancelled');
    const totalRevenue = completed.reduce((sum, m) => sum + Number(m.revenue || 0), 0);
    const totalCosts = completed.reduce((sum, m) => sum + Number(m.instructorPayment || 0), 0);

    return {
      totalMeetings: meetings.length,
      completedMeetings: completed.length,
      cancelledMeetings: cancelled.length,
      totalRevenue,
      totalCosts,
      profit: totalRevenue - totalCosts,
    };
  }, [meetings]);

  // Branch billing summary
  const branchBilling = useMemo(() => {
    if (!meetings || !Array.isArray(meetings)) return [];

    const byBranch: Record<string, {
      branchId: string;
      branchName: string;
      completedMeetings: number;
      totalRevenue: number;
      meetings: typeof meetings;
    }> = {};

    meetings.forEach((meeting) => {
      if (meeting.status !== 'completed') return;
      const branchId = meeting.cycle?.branch?.id || 'unknown';
      const branchName = meeting.cycle?.branch?.name || 'לא מוגדר';
      
      if (!byBranch[branchId]) {
        byBranch[branchId] = {
          branchId,
          branchName,
          completedMeetings: 0,
          totalRevenue: 0,
          meetings: [],
        };
      }
      
      byBranch[branchId].completedMeetings++;
      byBranch[branchId].totalRevenue += Number(meeting.revenue || 0);
      byBranch[branchId].meetings.push(meeting);
    });

    return Object.values(byBranch).sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [meetings]);

  const selectedBranch = useMemo(() => {
    return branches?.find((b) => b.id === branchFilter);
  }, [branches, branchFilter]);

  const detailBranch = useMemo(() => {
    return branches?.find((b) => b.id === detailBranchId);
  }, [branches, detailBranchId]);

  const detailBranchData = useMemo(() => {
    return branchBilling.find((b) => b.branchId === detailBranchId);
  }, [branchBilling, detailBranchId]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
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

  const exportBillingReport = (branchId?: string) => {
    const targetBranchId = branchId || branchFilter || detailBranchId;
    const targetBranch = branches?.find((b) => b.id === targetBranchId);
    
    if (!targetBranchId || !targetBranch) {
      alert('יש לבחור סניף לפני הפקת דוח גבייה');
      return;
    }

    const branchData = branchBilling.find((b) => b.branchId === targetBranchId);
    if (!branchData) return;

    // Create CSV content
    let csv = '\ufeff'; // BOM for Hebrew
    csv += `דוח גבייה - ${targetBranch.name}\n`;
    csv += `תקופה: ${dateRange.from} עד ${dateRange.to}\n\n`;
    csv += 'תאריך,שעה,מחזור,קורס,מדריך,סכום\n';

    branchData.meetings.forEach((meeting) => {
      const date = meeting.scheduledDate ? new Date(meeting.scheduledDate).toLocaleDateString('he-IL') : '';
      const time = meeting.startTime ? formatTime(meeting.startTime) : '';
      const cycleName = meeting.cycle?.name || '';
      const courseName = meeting.cycle?.course?.name || '';
      const instructorName = meeting.instructor?.name || '';
      const revenue = meeting.revenue || 0;
      csv += `${date},${time},"${cycleName}","${courseName}","${instructorName}",${revenue}\n`;
    });

    csv += `\nסה"כ מפגשים,${branchData.completedMeetings}\n`;
    csv += `סה"כ לגבייה,₪${branchData.totalRevenue.toLocaleString()}\n`;

    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `billing-${targetBranch.name}-${dateRange.from}-${dateRange.to}.csv`;
    link.click();
  };

  const isLoading = loadingMeetings || loadingCycles || loadingInstructors || loadingBranches;

  if (isLoading) {
    return <Loading size="lg" text="טוען דוחות..." />;
  }

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader
        title="דוחות"
        subtitle="סיכום פעילות ונתונים כספיים"
      />

      <div className="flex-1 p-6 overflow-auto bg-gray-50">
        {/* WooCommerce Sync */}
        <div className="bg-white rounded-lg p-4 shadow mb-4 flex items-center gap-4 flex-wrap">
          <CreditCard size={18} className="text-purple-600 shrink-0" />
          <span className="font-medium text-sm text-gray-700">סנכרון תשלומים מ-WooCommerce</span>
          <div className="flex gap-2 flex-wrap">
            {[7, 14, 30].map(d => (
              <button key={d}
                onClick={() => syncWooPayments(d)}
                disabled={syncStatus.loading}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {syncStatus.loading ? '⏳ מסנכרן...' : `${d} ימים אחרונים`}
              </button>
            ))}
          </div>
          {syncStatus.result && <span className="text-sm text-green-600 font-medium">{syncStatus.result}</span>}
          {syncStatus.error && <span className="text-sm text-red-500">{syncStatus.error}</span>}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg p-4 shadow mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <Calendar className="text-gray-400" size={20} />
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">מתאריך:</label>
              <input
                type="date"
                value={dateRange.from}
                onChange={(e) => setDateRange((d) => ({ ...d, from: e.target.value }))}
                className="border rounded px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">עד תאריך:</label>
              <input
                type="date"
                value={dateRange.to}
                onChange={(e) => setDateRange((d) => ({ ...d, to: e.target.value }))}
                className="border rounded px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="text-gray-400" size={18} />
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm min-w-[150px]"
              >
                <option value="">כל הסניפים</option>
                {branches?.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <RefreshCw className="text-gray-400" size={18} />
              <label className="text-sm text-gray-600">מחזורים:</label>
              <select
                value={cyclesLimit}
                onChange={(e) => setCyclesLimit(Number(e.target.value))}
                className="border rounded px-3 py-1.5 text-sm"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'overview'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            <BarChart3 size={18} className="inline me-2" />
            סיכום כללי
          </button>
          <button
            onClick={() => setActiveTab('billing')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'billing'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            <FileText size={18} className="inline me-2" />
            גבייה לפי סניף
          </button>
          <button
            onClick={() => setActiveTab('cycles')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'cycles'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            <RefreshCw size={18} className="inline me-2" />
            מחזורים ({cycles?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('instructors')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'instructors'
                ? 'bg-purple-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Users size={18} className="inline me-2" />
            דוח מדריכים
          </button>
        </div>

        {activeTab === 'overview' && (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-white rounded-lg p-6 shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">סה"כ מפגשים</p>
                    <p className="text-3xl font-bold text-gray-900">{stats.totalMeetings}</p>
                    <p className="text-sm text-green-600">
                      {stats.completedMeetings} הושלמו
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <Calendar className="text-blue-600" size={24} />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-6 shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">הכנסות</p>
                    <p className="text-3xl font-bold text-gray-900">
                      ₪{stats.totalRevenue.toLocaleString()}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <TrendingUp className="text-green-600" size={24} />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-6 shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">הוצאות</p>
                    <p className="text-3xl font-bold text-gray-900">
                      ₪{stats.totalCosts.toLocaleString()}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                    <DollarSign className="text-red-600" size={24} />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-6 shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">רווח</p>
                    <p className={`text-3xl font-bold ${stats.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ₪{stats.profit.toLocaleString()}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                    <BarChart3 className="text-purple-600" size={24} />
                  </div>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg p-6 shadow">
                <h3 className="text-lg font-semibold mb-4">מחזורים פעילים</h3>
                <p className="text-4xl font-bold text-blue-600">
                  {cycles?.length ?? 0}
                </p>
                <p className="text-sm text-gray-500 mt-2">מחזורים בסטטוס פעיל (מוצגים {cyclesLimit})</p>
              </div>

              <div className="bg-white rounded-lg p-6 shadow">
                <h3 className="text-lg font-semibold mb-4">מדריכים פעילים</h3>
                <p className="text-4xl font-bold text-green-600">
                  {Array.isArray(instructors) ? instructors.filter((i) => i.isActive).length : 0}
                </p>
                <p className="text-sm text-gray-500 mt-2">מדריכים זמינים להדרכה</p>
              </div>
            </div>
          </>
        )}

        {activeTab === 'billing' && (
          <div className="space-y-6">
            {/* Branch Billing Summary */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="p-4 border-b">
                <h3 className="text-lg font-semibold">סיכום גבייה לפי סניף</h3>
              </div>
              
              {branchBilling.length > 0 ? (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-right p-3 font-medium text-gray-600">סניף</th>
                      <th className="text-right p-3 font-medium text-gray-600">מפגשים שהתקיימו</th>
                      <th className="text-right p-3 font-medium text-gray-600">סכום לגבייה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchBilling.map((branch) => (
                      <tr
                        key={branch.branchId}
                        className={`border-t hover:bg-gray-50 ${
                          detailBranchId === branch.branchId ? 'bg-blue-50' : ''
                        }`}
                      >
                        <td className="p-3 font-medium">{branch.branchName}</td>
                        <td className="p-3">
                          <button
                            onClick={() => setDetailBranchId(detailBranchId === branch.branchId ? null : branch.branchId)}
                            className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                            title="לחץ לצפייה בפירוט המפגשים"
                          >
                            {branch.completedMeetings}
                          </button>
                        </td>
                        <td className="p-3 font-semibold text-green-600">
                          ₪{branch.totalRevenue.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100 font-bold">
                    <tr>
                      <td className="p-3">סה"כ</td>
                      <td className="p-3">{branchBilling.reduce((sum, b) => sum + b.completedMeetings, 0)}</td>
                      <td className="p-3 text-green-600">
                        ₪{branchBilling.reduce((sum, b) => sum + b.totalRevenue, 0).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <div className="p-8 text-center text-gray-500">
                  אין מפגשים שהתקיימו בתקופה הנבחרת
                </div>
              )}
            </div>

            {/* Detailed Branch Report */}
            {detailBranchId && detailBranchData && (
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="p-4 border-b flex items-center justify-between">
                  <h3 className="text-lg font-semibold">
                    פירוט מפגשים - {detailBranch?.name}
                  </h3>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => exportBillingReport(detailBranchId!)}
                      className="btn btn-primary flex items-center gap-2 text-sm"
                    >
                      <Download size={16} />
                      הורד דוח
                    </button>
                    <button
                      onClick={() => setDetailBranchId(null)}
                      className="text-gray-400 hover:text-gray-600 text-xl font-light"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                
                {detailBranchData.meetings.length ? (
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-right p-3 font-medium text-gray-600">תאריך</th>
                        <th className="text-right p-3 font-medium text-gray-600">שעה</th>
                        <th className="text-right p-3 font-medium text-gray-600">מחזור</th>
                        <th className="text-right p-3 font-medium text-gray-600">קורס</th>
                        <th className="text-right p-3 font-medium text-gray-600">מדריך</th>
                        <th className="text-right p-3 font-medium text-gray-600">סכום</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailBranchData.meetings
                        .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime())
                        .map((meeting) => (
                          <tr key={meeting.id} className="border-t hover:bg-gray-50">
                            <td className="p-3">{formatDate(meeting.scheduledDate)}</td>
                            <td className="p-3">{formatTime(meeting.startTime)}</td>
                            <td className="p-3">{meeting.cycle?.name}</td>
                            <td className="p-3">{meeting.cycle?.course?.name}</td>
                            <td className="p-3">{meeting.instructor?.name}</td>
                            <td className="p-3 font-medium">₪{Number(meeting.revenue || 0).toLocaleString()}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center text-gray-500">
                    אין מפגשים שהתקיימו בסניף זה בתקופה הנבחרת
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'instructors' && <InstructorReportTab />}

        {activeTab === 'cycles' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between">
                <h3 className="text-lg font-semibold">מחזורים פעילים</h3>
                <span className="text-sm text-gray-500">מציג {cycles?.length || 0} מחזורים</span>
              </div>
              
              {cycles && cycles.length > 0 ? (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-right p-3 font-medium text-gray-600">שם</th>
                      <th className="text-right p-3 font-medium text-gray-600">קורס</th>
                      <th className="text-right p-3 font-medium text-gray-600">סניף</th>
                      <th className="text-right p-3 font-medium text-gray-600">מדריך</th>
                      <th className="text-right p-3 font-medium text-gray-600">יום</th>
                      <th className="text-right p-3 font-medium text-gray-600">שעה</th>
                      <th className="text-right p-3 font-medium text-gray-600">תלמידים</th>
                      <th className="text-right p-3 font-medium text-gray-600">התקדמות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycles.map((cycle) => {
                      const dayNames: Record<string, string> = {
                        sunday: 'ראשון',
                        monday: 'שני',
                        tuesday: 'שלישי',
                        wednesday: 'רביעי',
                        thursday: 'חמישי',
                        friday: 'שישי',
                        saturday: 'שבת',
                      };
                      const progress = cycle.totalMeetings > 0 
                        ? Math.round((cycle.completedMeetings / cycle.totalMeetings) * 100) 
                        : 0;
                      return (
                        <tr key={cycle.id} className="border-t hover:bg-gray-50">
                          <td className="p-3 font-medium">{cycle.name}</td>
                          <td className="p-3">{cycle.course?.name || '-'}</td>
                          <td className="p-3">{cycle.branch?.name || '-'}</td>
                          <td className="p-3">{cycle.instructor?.name || '-'}</td>
                          <td className="p-3">{dayNames[cycle.dayOfWeek?.toLowerCase()] || cycle.dayOfWeek || '-'}</td>
                          <td className="p-3">{cycle.startTime?.substring(0, 5) || '-'}</td>
                          <td className="p-3">{cycle.studentCount || cycle._count?.registrations || 0}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="w-24 bg-gray-200 rounded-full h-2">
                                <div 
                                  className="bg-blue-600 h-2 rounded-full" 
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                              <span className="text-sm text-gray-600">
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
                <div className="p-8 text-center text-gray-500">
                  אין מחזורים פעילים
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
