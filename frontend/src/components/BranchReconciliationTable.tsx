import { useMemo, useState } from 'react';
import { GitCompareArrows, AlertCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useBranchReconciliation } from '../hooks/useApi';
import Loading from './ui/Loading';

const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
function monthLabel(m: string) {
  const [y, mm] = m.split('-').map(Number);
  return `${HEBREW_MONTHS[mm - 1].slice(0, 3)} ${String(y).slice(2)}`;
}

export default function BranchReconciliationTable() {
  const [range, setRange] = useState<'ytd' | number>('ytd');
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [hideMatched, setHideMatched] = useState(false);
  const { data, isLoading, error } = useBranchReconciliation(range);

  const filteredBranches = useMemo(() => {
    if (!data) return [];
    if (!hideMatched) return data.branches;
    return data.branches.filter((b) => Math.abs(b.diff) > 1);
  }, [data, hideMatched]);

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
          <span>שגיאה בטעינת ההתאמות</span>
        </div>
      </div>
    );
  }

  const totalCrm = data.branches.reduce((s, b) => s + b.crmTotal, 0);
  const totalMorning = data.branches.reduce((s, b) => s + b.morningTotal, 0);
  const totalDiff = totalCrm - totalMorning;
  const unmatchedTotal = data.unmatchedClients.reduce((s, c) => s + c.total, 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-50 rounded-lg">
            <GitCompareArrows className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">התאמות סניפים — CRM ↔ מורנינג</h2>
            <p className="text-sm text-gray-500">השוואת הכנסה מוכרת מול חשבוניות מס/קבלה</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={hideMatched} onChange={(e) => setHideMatched(e.target.checked)} />
            הצג רק פערים
          </label>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value === 'ytd' ? 'ytd' : Number(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-purple-500"
          >
            <option value="ytd">מתחילת השנה</option>
            <option value={3}>3 חודשים</option>
            <option value={6}>6 חודשים</option>
            <option value={12}>12 חודשים</option>
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-emerald-50 rounded-lg p-3">
          <div className="text-xs text-emerald-700">הכנסה ב-CRM</div>
          <div className="text-xl font-bold text-emerald-800">₪{totalCrm.toLocaleString()}</div>
        </div>
        <div className="bg-indigo-50 rounded-lg p-3">
          <div className="text-xs text-indigo-700">חשבוניות במורנינג</div>
          <div className="text-xl font-bold text-indigo-800">₪{totalMorning.toLocaleString()}</div>
        </div>
        <div className={`rounded-lg p-3 ${Math.abs(totalDiff) < 1000 ? 'bg-emerald-50' : 'bg-amber-50'}`}>
          <div className={`text-xs ${Math.abs(totalDiff) < 1000 ? 'text-emerald-700' : 'text-amber-700'}`}>פער כולל</div>
          <div className={`text-xl font-bold ${Math.abs(totalDiff) < 1000 ? 'text-emerald-800' : 'text-amber-800'}`}>
            ₪{totalDiff.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Reconciliation Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="text-right py-2 px-3 font-semibold sticky right-0 bg-gray-50 min-w-[180px]">סניף</th>
              <th className="text-right py-2 px-3 font-semibold text-gray-400 text-xs">לקוח במורנינג</th>
              {data.months.map((m) => (
                <th key={m} className="text-right py-2 px-2 font-semibold text-xs whitespace-nowrap" colSpan={2}>{monthLabel(m)}</th>
              ))}
              <th className="text-right py-2 px-3 font-semibold whitespace-nowrap">סה״כ פער</th>
            </tr>
            <tr className="text-gray-400 border-b border-gray-200 bg-gray-50 text-[10px]">
              <th className="sticky right-0 bg-gray-50"></th>
              <th></th>
              {data.months.map((m) => (
                <>
                  <th key={`${m}-c`} className="text-right py-1 px-2 font-medium">CRM</th>
                  <th key={`${m}-m`} className="text-right py-1 px-2 font-medium">מורנינג</th>
                </>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredBranches.map((b) => (
              <tr key={b.branchId} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-3 font-medium sticky right-0 bg-white">{b.branchName}</td>
                <td className="py-2 px-3 text-xs">
                  {b.matchedClients.length === 0 ? (
                    <span className="text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> לא נמצאה התאמה
                    </span>
                  ) : (
                    b.matchedClients.map((c, i) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        {c.clientId ? (
                          <a
                            href={`https://app.greeninvoice.co.il/i#/clients/${c.clientId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:underline"
                          >
                            {c.name} ↗
                          </a>
                        ) : (
                          <span className="text-gray-500">{c.name}</span>
                        )}
                      </span>
                    ))
                  )}
                </td>
                {b.monthly.map((m) => (
                  <>
                    <td key={`${m.month}-c`} className="py-1 px-2 text-emerald-600 text-xs">
                      {m.crm > 0 ? `₪${m.crm.toLocaleString()}` : ''}
                    </td>
                    <td key={`${m.month}-m`} className={`py-1 px-2 text-xs ${m.diff > 100 ? 'bg-amber-50 text-amber-700' : 'text-indigo-600'}`}>
                      {m.morning > 0 ? `₪${m.morning.toLocaleString()}` : ''}
                    </td>
                  </>
                ))}
                <td className={`py-2 px-3 font-bold ${Math.abs(b.diff) < 100 ? 'text-emerald-600' : b.diff > 0 ? 'text-amber-600' : 'text-rose-600'}`}>
                  ₪{b.diff.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-semibold">
              <td className="py-2 px-3 sticky right-0 bg-gray-100">סה״כ</td>
              <td></td>
              {data.months.map((m) => {
                const crm = filteredBranches.reduce((s, b) => s + (b.monthly.find((x) => x.month === m)?.crm ?? 0), 0);
                const mor = filteredBranches.reduce((s, b) => s + (b.monthly.find((x) => x.month === m)?.morning ?? 0), 0);
                return (
                  <>
                    <td key={`tf-${m}-c`} className="py-2 px-2 text-emerald-600 text-xs">₪{crm.toLocaleString()}</td>
                    <td key={`tf-${m}-m`} className="py-2 px-2 text-indigo-600 text-xs">₪{mor.toLocaleString()}</td>
                  </>
                );
              })}
              <td className={`py-2 px-3 ${Math.abs(totalDiff) < 1000 ? 'text-emerald-600' : 'text-amber-600'}`}>₪{totalDiff.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Unmatched Morning clients */}
      {data.unmatchedClients.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <button
            onClick={() => setShowUnmatched(!showUnmatched)}
            className="w-full flex items-center justify-between text-sm hover:bg-gray-50 rounded-lg px-2 py-1.5"
          >
            <span className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-4 h-4" />
              {data.unmatchedClients.length} לקוחות במורנינג ללא התאמה לסניף — סה״כ ₪{unmatchedTotal.toLocaleString()}
            </span>
            {showUnmatched ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showUnmatched && (
            <div className="mt-2 space-y-1">
              {data.unmatchedClients.map((c) => (
                <div key={c.name} className="flex items-center justify-between text-sm text-gray-700 px-2 py-1">
                  <span>{c.name}</span>
                  <span className="text-indigo-600 font-medium">₪{c.total.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
