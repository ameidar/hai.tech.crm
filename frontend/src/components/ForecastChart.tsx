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
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Target,
  Activity,
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

export default function ForecastChart() {
  const [historicalMonths, setHistoricalMonths] = useState(6);
  const [forecastMonths, setForecastMonths] = useState(3);
  const [showPatterns, setShowPatterns] = useState(false);
  
  const { data, isLoading, error } = useForecast(historicalMonths, forecastMonths);

  const chartData = useMemo(() => {
    if (!data) return [];
    
    // Combine historical and forecast data
    const combined = [
      ...data.historical.map(d => ({ ...d, type: 'historical' })),
      ...data.forecast.map(d => ({ ...d, type: 'forecast' })),
    ];

    // Calculate upper/lower bounds for forecast based on std dev
    return combined.map((d, i) => {
      if (d.type === 'forecast' && data.summary) {
        return {
          ...d,
          profitUpper: d.profit + data.summary.profitStdDev,
          profitLower: d.profit - data.summary.profitStdDev,
          revenueUpper: d.revenue + data.summary.revenueStdDev,
          revenueLower: d.revenue - data.summary.revenueStdDev,
        };
      }
      return d;
    });
  }, [data]);

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
  const lastForecast = data.forecast[data.forecast.length - 1];

  // Find where forecast starts (index of first forecast month)
  const forecastStartIndex = data.historical.length;

  return (
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
              {forecastMonths} חודשים קדימה • רמת ביטחון {summary.forecastConfidence}%
            </p>
          </div>
        </div>
        
        {/* Controls */}
        <div className="flex items-center gap-4">
          <select
            value={historicalMonths}
            onChange={(e) => setHistoricalMonths(Number(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500"
          >
            <option value={3}>3 חודשים היסטוריה</option>
            <option value={6}>6 חודשים היסטוריה</option>
            <option value={12}>12 חודשים היסטוריה</option>
          </select>
          <select
            value={forecastMonths}
            onChange={(e) => setForecastMonths(Number(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500"
          >
            <option value={1}>תחזית לחודש</option>
            <option value={3}>תחזית ל-3 חודשים</option>
            <option value={6}>תחזית ל-6 חודשים</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-emerald-700">צפי הכנסות (ממוצע)</span>
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
            <span className="text-sm text-rose-700">צפי הוצאות (ממוצע)</span>
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
            <span className="text-sm text-sky-700">צפי רווח (ממוצע)</span>
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
        <ResponsiveContainer width="100%" height="100%">
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
                  profitUpper: 'רווח (גבול עליון)',
                  profitLower: 'רווח (גבול תחתון)',
                };
                const numValue = typeof value === 'number' ? value : 0;
                const strName = String(name || '');
                return [`₪${numValue.toLocaleString()}`, labels[strName] || strName];
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
            
            {/* Forecast area indicator */}
            {forecastStartIndex > 0 && (
              <ReferenceLine 
                x={chartData[forecastStartIndex]?.monthName} 
                stroke="#6366f1" 
                strokeDasharray="5 5"
                label={{ value: 'תחזית', position: 'top', fill: '#6366f1', fontSize: 12 }}
              />
            )}

            {/* Revenue */}
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#10b981"
              fill="url(#revenueGradient)"
              strokeWidth={2}
            />

            {/* Expenses */}
            <Area
              type="monotone"
              dataKey="totalExpenses"
              stroke="#f43f5e"
              fill="url(#expenseGradient)"
              strokeWidth={2}
            />

            {/* Profit with confidence bounds */}
            <Area
              type="monotone"
              dataKey="profitUpper"
              stroke="transparent"
              fill="#0ea5e9"
              fillOpacity={0.1}
            />
            <Area
              type="monotone"
              dataKey="profitLower"
              stroke="transparent"
              fill="white"
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

      {/* Expense Patterns */}
      {patterns.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <button
            onClick={() => setShowPatterns(!showPatterns)}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            {showPatterns ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            דפוסי הוצאות ({patterns.length})
          </button>
          
          {showPatterns && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {patterns.map((pattern, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                  <div>
                    <span className="font-medium text-gray-900 text-sm">
                      {expenseTypeLabels[pattern.type] || pattern.type}
                    </span>
                    <span className="text-xs text-gray-500 mr-2">
                      ({pattern.cycleName})
                    </span>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold text-gray-900">
                      ₪{Math.round(pattern.avgAmount).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500">
                      {Math.round(pattern.frequency * 100)}% מהחודשים
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Monthly Breakdown */}
      <div className="border-t border-gray-100 pt-4 mt-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">פירוט חודשי</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-100">
                <th className="text-right py-2 font-medium">חודש</th>
                <th className="text-right py-2 font-medium">פגישות</th>
                <th className="text-right py-2 font-medium">הכנסות</th>
                <th className="text-right py-2 font-medium">תשלום מדריכים</th>
                <th className="text-right py-2 font-medium">הוצאות מחזור</th>
                <th className="text-right py-2 font-medium">הוצאות פגישה</th>
                <th className="text-right py-2 font-medium">סה״כ הוצאות</th>
                <th className="text-right py-2 font-medium">רווח</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((row, i) => (
                <tr 
                  key={row.month} 
                  className={`border-b border-gray-50 ${row.type === 'forecast' ? 'bg-indigo-50/30' : ''}`}
                >
                  <td className="py-2">
                    <span className={row.type === 'forecast' ? 'text-indigo-600 font-medium' : ''}>
                      {row.monthName}
                    </span>
                    {row.type === 'forecast' && (
                      <span className="text-xs text-indigo-400 mr-1">(תחזית)</span>
                    )}
                  </td>
                  <td className="py-2 text-gray-600">{row.meetingCount}</td>
                  <td className="py-2 text-emerald-600">₪{row.revenue.toLocaleString()}</td>
                  <td className="py-2 text-rose-500">₪{Math.round(row.instructorPayments).toLocaleString()}</td>
                  <td className="py-2 text-rose-500">₪{Math.round(row.cycleExpenses).toLocaleString()}</td>
                  <td className="py-2 text-rose-500">₪{Math.round(row.meetingExpenses).toLocaleString()}</td>
                  <td className="py-2 text-rose-600 font-medium">₪{Math.round(row.totalExpenses).toLocaleString()}</td>
                  <td className={`py-2 font-semibold ${row.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    ₪{Math.round(row.profit).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
