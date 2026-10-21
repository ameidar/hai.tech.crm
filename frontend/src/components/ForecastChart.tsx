import { useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  ComposedChart,
  Bar,
  BarChart,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Target,
  Activity,
  History,
  Sparkles,
  Calculator,
  Info,
} from 'lucide-react';
import { useForecast } from '../hooks/useApi';
import Loading from './ui/Loading';

const expenseTypeLabels: Record<string, string> = {
  travel: 'נסיעות',
  materials: 'חומרים',
  extra_instructor: 'מדריך נוסף',
  equipment: 'ציוד',
  food: 'כיבוד',
  other: 'אחר',
};

type ViewMode = 'all' | 'historical' | 'forecast';

// Fixed monthly costs = company fixed costs (staff salaries) + instructor fixed additions.
const fixedCostsOf = (row: { fixedInstructorAdditions?: number; companyFixedCosts?: number }) =>
  (row.fixedInstructorAdditions ?? 0) + (row.companyFixedCosts ?? 0);

export default function ForecastChart() {
  const [historicalMonths, setHistoricalMonths] = useState(6);
  const [forecastMonths, setForecastMonths] = useState(3);
  const [showPatterns, setShowPatterns] = useState(false);
  const [showCalculation, setShowCalculation] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  
  const { data, isLoading, error } = useForecast(historicalMonths, forecastMonths);

  const chartData = useMemo(() => {
    if (!data) return [];
    
    let combined: any[] = [];
    
    if (viewMode === 'all' || viewMode === 'historical') {
      combined = [...combined, ...data.historical.map(d => ({ ...d, type: 'historical' }))];
    }
    if (viewMode === 'all' || viewMode === 'forecast') {
      combined = [...combined, ...data.forecast.map(d => ({ ...d, type: 'forecast' }))];
    }

    return combined.map((d) => {
      if (d.type === 'forecast' && data.summary) {
        return {
          ...d,
          profitUpper: d.profit + data.summary.profitStdDev,
          profitLower: Math.max(0, d.profit - data.summary.profitStdDev),
        };
      }
      return d;
    });
  }, [data, viewMode]);

  const forecastStartIndex = useMemo(() => {
    if (!data || viewMode !== 'all') return -1;
    return data.historical.length;
  }, [data, viewMode]);

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <Loading />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle className="w-5 h-5" />
          <span>שגיאה בטעינת התחזית</span>
        </div>
      </div>
    );
  }

  const { summary, patterns } = data;

  return (
    <div className="space-y-6">
      {/* Main Forecast Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-lg">
              <Target className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">תחזית פיננסית</h2>
              <p className="text-sm text-gray-500">
                היסטוריה + תחזית • רמת ביטחון {summary.forecastConfidence}%
              </p>
            </div>
          </div>
          
          {/* View Mode Toggle */}
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('historical')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'historical' 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <History className="w-4 h-4" />
              היסטוריה
            </button>
            <button
              onClick={() => setViewMode('all')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'all' 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              הכל
            </button>
            <button
              onClick={() => setViewMode('forecast')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'forecast' 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              תחזית
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-6">
          <select
            value={historicalMonths}
            onChange={(e) => setHistoricalMonths(Number(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500"
          >
            <option value={3}>3 חודשים אחורה</option>
            <option value={6}>6 חודשים אחורה</option>
            <option value={12}>12 חודשים אחורה</option>
          </select>
          <select
            value={forecastMonths}
            onChange={(e) => setForecastMonths(Number(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500"
          >
            <option value={1}>חודש קדימה</option>
            <option value={3}>3 חודשים קדימה</option>
            <option value={6}>6 חודשים קדימה</option>
          </select>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-emerald-700">ממוצע הכנסות</span>
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold text-emerald-800">
                ₪{summary.avgMonthlyRevenue.toLocaleString()}
              </span>
              <span className="text-xs text-emerald-600 mr-2">
                ±{summary.revenueStdDev.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-rose-50 to-rose-100 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-rose-700">ממוצע הוצאות</span>
              <TrendingDown className="w-4 h-4 text-rose-600" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold text-rose-800">
                ₪{summary.avgMonthlyExpenses.toLocaleString()}
              </span>
              <span className="text-xs text-rose-600 mr-2">
                ±{summary.expensesStdDev.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-sky-50 to-sky-100 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-sky-700">ממוצע רווח</span>
              <Activity className="w-4 h-4 text-sky-600" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold text-sky-800">
                ₪{summary.avgMonthlyProfit.toLocaleString()}
              </span>
              <span className="text-xs text-sky-600 mr-2">
                ±{summary.profitStdDev.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-amber-700">רמת ביטחון</span>
              <Target className="w-4 h-4 text-amber-600" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold text-amber-800">
                {summary.forecastConfidence}%
              </span>
              <div className="mt-1 w-full bg-amber-200 rounded-full h-1.5">
                <div
                  className="bg-amber-600 h-1.5 rounded-full"
                  style={{ width: `${summary.forecastConfidence}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Main Chart */}
        <div className="h-80 mb-6">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="monthName" 
                tick={{ fontSize: 12 }}
                tickLine={false}
              />
              <YAxis 
                tick={{ fontSize: 12 }}
                tickFormatter={(value) => `₪${(value / 1000).toFixed(0)}K`}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value, name) => {
                  const labels: Record<string, string> = {
                    revenue: 'הכנסות',
                    totalExpenses: 'הוצאות',
                    profit: 'רווח',
                  };
                  const numValue = typeof value === 'number' ? value : 0;
                  const strName = String(name || '');
                  return [`₪${numValue.toLocaleString()}`, labels[strName] || strName];
                }}
                labelFormatter={(label, payload) => {
                  if (payload && payload[0]) {
                    const d = payload[0].payload as { isPartial?: boolean; completedCount?: number; scheduledCount?: number };
                    if (d.isPartial) {
                      return `${label} ✦ (${d.completedCount ?? 0} הושלמו + ${d.scheduledCount ?? 0} מתוכנן)`;
                    }
                  }
                  return label;
                }}
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                }}
              />
              <Legend 
                formatter={(value) => {
                  const labels: Record<string, string> = {
                    revenue: 'הכנסות',
                    totalExpenses: 'הוצאות',
                    profit: 'רווח',
                  };
                  return labels[value] || value;
                }}
              />
              
              {/* Partial month indicator (current month: actual + estimated) */}
              {chartData.map((d: { isPartial?: boolean; monthName?: string }) =>
                d.isPartial ? (
                  <ReferenceLine
                    key={`partial-${d.monthName}`}
                    x={d.monthName}
                    stroke="#f59e0b"
                    strokeDasharray="4 4"
                    label={{ value: '✦ חלקי', position: 'insideTopRight', fill: '#d97706', fontSize: 11 }}
                  />
                ) : null
              )}

              {/* Forecast area indicator */}
              {forecastStartIndex > 0 && chartData[forecastStartIndex] && (
                <ReferenceLine 
                  x={chartData[forecastStartIndex]?.monthName} 
                  stroke="#6366f1" 
                  strokeDasharray="5 5"
                  label={{ value: '← תחזית', position: 'top', fill: '#6366f1', fontSize: 12 }}
                />
              )}

              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#10b981"
                fill="url(#revenueGradient)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="totalExpenses"
                stroke="#f43f5e"
                fill="url(#expenseGradient)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="profit"
                stroke="#0ea5e9"
                fill="url(#profitGradient)"
                strokeWidth={2}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Monthly Breakdown Table */}
        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            פירוט חודשי
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="text-right py-3 px-2 font-semibold">חודש</th>
                  <th className="text-right py-3 px-2 font-semibold">סוג</th>
                  <th className="text-right py-3 px-2 font-semibold">פגישות</th>
                  <th className="text-right py-3 px-2 font-semibold text-emerald-600">הכנסות</th>
                  <th className="text-right py-3 px-2 font-semibold text-rose-600">תשלום מדריכים</th>
                  <th className="text-right py-3 px-2 font-semibold text-rose-600">הוצאות מחזור</th>
                  <th className="text-right py-3 px-2 font-semibold text-rose-600">הוצאות פגישה</th>
                  <th className="text-right py-3 px-2 font-semibold text-rose-600">הוצאות קבועות</th>
                  <th className="text-right py-3 px-2 font-semibold text-rose-700">סה״כ הוצאות</th>
                  <th className="text-right py-3 px-2 font-semibold text-sky-600">רווח</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((row, i) => (
                  <tr 
                    key={row.month} 
                    className={`border-b border-gray-100 hover:bg-gray-50 ${
                      row.isPartial ? 'bg-amber-50/60' : row.type === 'forecast' ? 'bg-indigo-50/50' : ''
                    }`}
                  >
                    <td className="py-3 px-2 font-medium">{row.monthName}</td>
                    <td className="py-3 px-2">
                      {row.isPartial ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700" title={`${row.completedCount} הושלמו + ${row.scheduledCount} מתוכנן`}>
                          ✦ חלקי ({row.completedCount}+{row.scheduledCount})
                        </span>
                      ) : row.type === 'forecast' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                          <Sparkles className="w-3 h-3" />
                          תחזית
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                          <History className="w-3 h-3" />
                          בפועל
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-gray-600">{row.meetingCount}</td>
                    <td className="py-3 px-2 text-emerald-600 font-medium">₪{Math.round(row.revenue).toLocaleString()}</td>
                    <td className="py-3 px-2 text-rose-500">₪{Math.round(row.instructorPayments).toLocaleString()}</td>
                    <td className="py-3 px-2 text-rose-500">₪{Math.round(row.cycleExpenses).toLocaleString()}</td>
                    <td className="py-3 px-2 text-rose-500">₪{Math.round(row.meetingExpenses).toLocaleString()}</td>
                    <td
                      className="py-3 px-2 text-rose-500 cursor-help"
                      title={(row.fixedCostItems ?? [])
                        .map((i: { label: string; amount: number }) => `${i.label}: ₪${Math.round(i.amount).toLocaleString()}`)
                        .join('\n')}
                    >
                      ₪{Math.round(fixedCostsOf(row)).toLocaleString()}
                    </td>
                    <td className="py-3 px-2 text-rose-600 font-medium">₪{Math.round(row.totalExpenses).toLocaleString()}</td>
                    <td className={`py-3 px-2 font-bold ${row.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      ₪{Math.round(row.profit).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="py-3 px-2">סה״כ</td>
                  <td className="py-3 px-2"></td>
                  <td className="py-3 px-2 text-gray-700">
                    {chartData.reduce((sum, r) => sum + r.meetingCount, 0)}
                  </td>
                  <td className="py-3 px-2 text-emerald-600">
                    ₪{Math.round(chartData.reduce((sum, r) => sum + r.revenue, 0)).toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-rose-500">
                    ₪{Math.round(chartData.reduce((sum, r) => sum + r.instructorPayments, 0)).toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-rose-500">
                    ₪{Math.round(chartData.reduce((sum, r) => sum + r.cycleExpenses, 0)).toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-rose-500">
                    ₪{Math.round(chartData.reduce((sum, r) => sum + r.meetingExpenses, 0)).toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-rose-500">
                    ₪{Math.round(chartData.reduce((sum, r) => sum + fixedCostsOf(r), 0)).toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-rose-600">
                    ₪{Math.round(chartData.reduce((sum, r) => sum + r.totalExpenses, 0)).toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-sky-600">
                    ₪{Math.round(chartData.reduce((sum, r) => sum + r.profit, 0)).toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* Calculation Explanation Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <button
          onClick={() => setShowCalculation(!showCalculation)}
          className="flex items-center justify-between w-full"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Info className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-right">
              <h3 className="font-semibold text-gray-900">איך מחושבת התחזית?</h3>
              <p className="text-sm text-gray-500">פירוט שיטת החישוב והנתונים</p>
            </div>
          </div>
          {showCalculation ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </button>

        {showCalculation && (
          <div className="mt-4 space-y-4 text-sm text-gray-600 border-t border-gray-100 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-50 rounded-lg p-4">
                <h4 className="font-semibold text-emerald-800 mb-2">💰 הכנסות</h4>
                <ul className="space-y-1 text-emerald-700">
                  <li>• <strong>היסטוריה:</strong> סכום ה-revenue מכל הפגישות שהושלמו</li>
                  <li>• <strong>תחזית:</strong> סכום ה-revenue מפגישות מתוכננות</li>
                  <li>• מבוסס על מחיר לתלמיד × מספר תלמידים רשומים</li>
                </ul>
              </div>

              <div className="bg-rose-50 rounded-lg p-4">
                <h4 className="font-semibold text-rose-800 mb-2">📉 הוצאות</h4>
                <ul className="space-y-1 text-rose-700">
                  <li>• <strong>תשלום מדריכים:</strong> לפי תעריף × שעות לכל פגישה</li>
                  <li>• <strong>הוצאות מחזור:</strong> חומרים, ציוד - מחולק על פני הפגישות</li>
                  <li>• <strong>הוצאות פגישה:</strong> נסיעות, מדריך נוסף, כיבוד</li>
                  <li>• <strong>הוצאות קבועות:</strong> משכורות קבועות (הילה, אור) ותוספות קבועות למדריכים (ריכוז) — פירוט במעבר עכבר ובכרטיס ״הוצאות קבועות לפי חודש״</li>
                </ul>
              </div>
            </div>

            <div className="bg-indigo-50 rounded-lg p-4">
              <h4 className="font-semibold text-indigo-800 mb-2">🔮 חיזוי דפוסים</h4>
              <p className="text-indigo-700 mb-2">
                התחזית מתבססת על דפוסים היסטוריים. למשל:
              </p>
              <ul className="space-y-1 text-indigo-700">
                <li>• אם למחזור היו הוצאות נסיעה ב-60% מהחודשים → התחזית כוללת 60% מהסכום הממוצע</li>
                <li>• מדריך נוסף שהופיע באופן קבוע → נכלל בתחזית</li>
                <li>• סטיית התקן מחושבת מהשונות בנתונים ההיסטוריים</li>
              </ul>
            </div>

            <div className="bg-amber-50 rounded-lg p-4">
              <h4 className="font-semibold text-amber-800 mb-2">📊 רמת ביטחון</h4>
              <p className="text-amber-700">
                רמת הביטחון ({summary.forecastConfidence}%) מחושבת לפי עקביות הנתונים ההיסטוריים.
                ככל שהנתונים יותר עקביים (סטיית תקן נמוכה ביחס לממוצע), כך רמת הביטחון גבוהה יותר.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Expense Patterns Card */}
      {patterns.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <button
            onClick={() => setShowPatterns(!showPatterns)}
            className="flex items-center justify-between w-full"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-50 rounded-lg">
                <Activity className="w-5 h-5 text-purple-600" />
              </div>
              <div className="text-right">
                <h3 className="font-semibold text-gray-900">דפוסי הוצאות שזוהו</h3>
                <p className="text-sm text-gray-500">{patterns.length} דפוסים חוזרים</p>
              </div>
            </div>
            {showPatterns ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
          </button>

          {showPatterns && (
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4">
              {patterns.map((pattern, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                  <div>
                    <span className="font-medium text-gray-900 text-sm">
                      {expenseTypeLabels[pattern.type] || pattern.type}
                    </span>
                    <span className="text-xs text-gray-500 mr-2">
                      ({pattern.cycleName})
                    </span>
                    <div className="text-xs text-gray-400 mt-0.5">
                      מופיע ב-{Math.round(pattern.frequency * 100)}% מהחודשים
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold text-gray-900">
                      ₪{Math.round(pattern.avgAmount).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500">ממוצע</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
