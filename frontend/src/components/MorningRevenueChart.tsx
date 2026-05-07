import { useState } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, Activity, AlertCircle, RefreshCw } from 'lucide-react';
import { useMorningFinancials } from '../hooks/useApi';
import Loading from './ui/Loading';

export default function MorningRevenueChart() {
  const [range, setRange] = useState<'ytd' | number>(12);
  const { data, isLoading, error, refetch, isFetching } = useMorningFinancials(range);

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
          <span>שגיאה בטעינת נתוני מורנינג</span>
        </div>
      </div>
    );
  }

  const { months: monthData, globalEmployees } = data;
  const hasExpenses = true;
  const totalIncome = monthData.reduce((s, m) => s + m.income, 0);
  const totalMorningExp = monthData.reduce((s, m) => s + (m.morningExpenses ?? 0), 0);
  const totalInstructorPay = monthData.reduce((s, m) => s + (m.instructorPayments ?? 0), 0);
  const totalGlobalSal = monthData.reduce((s, m) => s + (m.globalSalaries ?? 0), 0);
  const totalExpenses = monthData.reduce((s, m) => s + m.expenses, 0);
  const totalProfit = totalIncome - totalExpenses;
  const avgIncome = Math.round(totalIncome / (monthData.filter(m => m.income > 0).length || 1));
  const globalEmpLabel = (globalEmployees ?? []).map(e => `${e.name} ₪${e.amount.toLocaleString()}`).join(' + ');

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 rounded-lg">
            <Activity className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">הכנסות והוצאות אמיתיות</h2>
            <p className="text-sm text-gray-500">נתונים ישירות ממורנינג</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value === 'ytd' ? 'ytd' : Number(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-emerald-500"
          >
            <option value="ytd">מתחילת השנה</option>
            <option value={3}>3 חודשים</option>
            <option value={6}>6 חודשים</option>
            <option value={12}>12 חודשים</option>
            <option value={24}>24 חודשים</option>
          </select>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="רענן"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className={`grid gap-4 ${hasExpenses ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-emerald-700">סה״כ הכנסות</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-emerald-800">
              ₪{totalIncome.toLocaleString()}
            </span>
            <div className="text-xs text-emerald-600 mt-1">
              ממוצע ₪{avgIncome.toLocaleString()} / חודש
            </div>
          </div>
        </div>

        {hasExpenses && (
          <div className="bg-gradient-to-br from-rose-50 to-rose-100 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-rose-700">סה״כ הוצאות</span>
              <TrendingDown className="w-4 h-4 text-rose-600" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold text-rose-800">
                ₪{totalExpenses.toLocaleString()}
              </span>
            </div>
          </div>
        )}

        <div className={`bg-gradient-to-br rounded-xl p-4 ${totalProfit >= 0 ? 'from-sky-50 to-sky-100' : 'from-orange-50 to-orange-100'}`}>
          <div className="flex items-center justify-between">
            <span className={`text-sm ${totalProfit >= 0 ? 'text-sky-700' : 'text-orange-700'}`}>
              {hasExpenses ? 'רווח נקי' : 'סה״כ גבייה'}
            </span>
            <Activity className={`w-4 h-4 ${totalProfit >= 0 ? 'text-sky-600' : 'text-orange-600'}`} />
          </div>
          <div className="mt-2">
            <span className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-sky-800' : 'text-orange-800'}`}>
              ₪{Math.abs(hasExpenses ? totalProfit : totalIncome).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Bar + Line Chart */}
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={monthData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="mIncomeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.9} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.6} />
              </linearGradient>
              <linearGradient id="mExpenseGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.9} />
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.6} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="monthName"
              tick={{ fontSize: 11 }}
              tickLine={false}
              interval={monthData.length > 12 ? 1 : 0}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `₪${(v / 1000).toFixed(0)}K`}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d: any = payload[0].payload;
                return (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
                    <div className="font-semibold text-gray-900 mb-2">{d.monthName}</div>
                    <div className="text-emerald-600">הכנסות: ₪{d.income?.toLocaleString()}</div>
                    <div className="border-t border-gray-100 my-1.5 pt-1.5 text-xs space-y-0.5">
                      <div className="text-rose-500">- הוצאות מורנינג: ₪{d.morningExpenses?.toLocaleString()}</div>
                      <div className="text-rose-500">- תשלום מדריכים: ₪{d.instructorPayments?.toLocaleString()}</div>
                      <div className="text-rose-500">- משכורות גלובליות: ₪{d.globalSalaries?.toLocaleString()}</div>
                    </div>
                    <div className="text-rose-600 font-medium border-t border-gray-100 pt-1.5">סה״כ הוצאות: ₪{d.expenses?.toLocaleString()}</div>
                    <div className={`font-bold mt-1 ${d.profit >= 0 ? 'text-sky-600' : 'text-orange-600'}`}>רווח: ₪{d.profit?.toLocaleString()}</div>
                  </div>
                );
              }}
            />
            <Legend
              formatter={(v) => {
                const labels: Record<string, string> = { income: 'הכנסות', expenses: 'הוצאות', profit: 'רווח' };
                return labels[v] ?? v;
              }}
            />
            <Bar dataKey="income" fill="url(#mIncomeGrad)" radius={[4, 4, 0, 0]} maxBarSize={40} />
            {hasExpenses && (
              <Bar dataKey="expenses" fill="url(#mExpenseGrad)" radius={[4, 4, 0, 0]} maxBarSize={40} />
            )}
            <Line
              type="monotone"
              dataKey={hasExpenses ? 'profit' : 'income'}
              stroke="#6366f1"
              strokeWidth={2}
              dot={{ r: 3, fill: '#6366f1' }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly Table */}
      <div className="border-t border-gray-100 pt-4">
        {globalEmpLabel && (
          <p className="text-xs text-gray-500 mb-2">משכורות גלובליות קבועות: {globalEmpLabel}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="text-right py-2 px-3 font-semibold">חודש</th>
                <th className="text-right py-2 px-3 font-semibold text-emerald-600">הכנסות</th>
                <th className="text-right py-2 px-3 font-semibold text-rose-500">מורנינג</th>
                <th className="text-right py-2 px-3 font-semibold text-rose-500">מדריכים</th>
                <th className="text-right py-2 px-3 font-semibold text-rose-500">משכורות</th>
                <th className="text-right py-2 px-3 font-semibold text-rose-600">סה״כ הוצאות</th>
                <th className="text-right py-2 px-3 font-semibold text-sky-600">רווח</th>
              </tr>
            </thead>
            <tbody>
              {monthData.map((row) => (
                <tr key={row.month} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 font-medium">{row.monthName}</td>
                  <td className="py-2 px-3 text-emerald-600 font-medium">{row.income > 0 ? `₪${row.income.toLocaleString()}` : '—'}</td>
                  <td className="py-2 px-3 text-rose-500">{row.morningExpenses > 0 ? `₪${row.morningExpenses.toLocaleString()}` : '—'}</td>
                  <td className="py-2 px-3 text-rose-500">{row.instructorPayments > 0 ? `₪${row.instructorPayments.toLocaleString()}` : '—'}</td>
                  <td className="py-2 px-3 text-rose-500">₪{row.globalSalaries.toLocaleString()}</td>
                  <td className="py-2 px-3 text-rose-600 font-medium">₪{row.expenses.toLocaleString()}</td>
                  <td className={`py-2 px-3 font-bold ${row.profit >= 0 ? 'text-sky-600' : 'text-rose-600'}`}>₪{row.profit.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-semibold">
                <td className="py-2 px-3">סה״כ</td>
                <td className="py-2 px-3 text-emerald-600">₪{totalIncome.toLocaleString()}</td>
                <td className="py-2 px-3 text-rose-500">₪{totalMorningExp.toLocaleString()}</td>
                <td className="py-2 px-3 text-rose-500">₪{totalInstructorPay.toLocaleString()}</td>
                <td className="py-2 px-3 text-rose-500">₪{totalGlobalSal.toLocaleString()}</td>
                <td className="py-2 px-3 text-rose-600">₪{totalExpenses.toLocaleString()}</td>
                <td className={`py-2 px-3 ${totalProfit >= 0 ? 'text-sky-600' : 'text-rose-600'}`}>₪{totalProfit.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
