import { useMemo, useState } from 'react';
import { GitCompareArrows, AlertCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { usePayingBodyReconciliation } from '../hooks/useApi';
import Loading from './ui/Loading';

const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
function monthLabel(m: string) {
  const [y, mm] = m.split('-').map(Number);
  return `${HEBREW_MONTHS[mm - 1].slice(0, 3)} ${String(y).slice(2)}`;
}
const money = (n: number) => `₪${n.toLocaleString()}`;

export default function PayingBodyReconciliationTable() {
  const [range, setRange] = useState<'ytd' | number>('ytd');
  const [showMissing, setShowMissing] = useState(false);
  const [hideMatched, setHideMatched] = useState(false);
  const { data, isLoading, error } = usePayingBodyReconciliation(range);

  const filteredBodies = useMemo(() => {
    if (!data) return [];
    if (!hideMatched) return data.payingBodies;
    // A gap exists when we earned more than we billed, or billed more than we collected.
    return data.payingBodies.filter(
      (b) => Math.abs(b.shouldBillTotal - b.issuedTotal) > 1 || Math.abs(b.issuedTotal - b.paidTotal) > 1
    );
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

  const totalShouldBill = data.payingBodies.reduce((s, b) => s + b.shouldBillTotal, 0);
  const totalIssued = data.payingBodies.reduce((s, b) => s + b.issuedTotal, 0);
  const totalPaid = data.payingBodies.reduce((s, b) => s + b.paidTotal, 0);
  const billGap = totalShouldBill - totalIssued; // earned but not yet invoiced
  const collectGap = totalIssued - totalPaid; // invoiced but not yet collected
  const missing = data.ordersWithoutPayingBody ?? [];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-50 rounded-lg">
            <GitCompareArrows className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">מעקב חיוב גוף משלם — צריך לחייב / חויב / שולם</h2>
            <p className="text-sm text-gray-500">לפי חודש הפעילות: הכנסת הפגישות מול חשבונות עסקה שהונפקו ומול מה ששולם בפועל · כל הסכומים כוללים מע״מ</p>
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
          <div className="text-xs text-emerald-700">צריך לחייב (פגישות)</div>
          <div className="text-xl font-bold text-emerald-800">{money(totalShouldBill)}</div>
        </div>
        <div className="bg-indigo-50 rounded-lg p-3">
          <div className="text-xs text-indigo-700">חויב — חשבון עסקה</div>
          <div className="text-xl font-bold text-indigo-800">{money(totalIssued)}</div>
          {Math.abs(billGap) > 1 && (
            <div className="text-[11px] text-amber-700 mt-0.5">חסר לחיוב: {money(billGap)}</div>
          )}
        </div>
        <div className="bg-sky-50 rounded-lg p-3">
          <div className="text-xs text-sky-700">שולם בפועל</div>
          <div className="text-xl font-bold text-sky-800">{money(totalPaid)}</div>
          {Math.abs(collectGap) > 1 && (
            <div className="text-[11px] text-amber-700 mt-0.5">טרם נגבה: {money(collectGap)}</div>
          )}
        </div>
      </div>

      {/* Reconciliation Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="text-right py-2 px-3 font-semibold sticky right-0 bg-gray-50 min-w-[180px]">גוף משלם</th>
              {data.months.map((m) => (
                <th key={m} className="text-center py-2 px-2 font-semibold text-xs whitespace-nowrap border-r border-gray-200" colSpan={3}>{monthLabel(m)}</th>
              ))}
              <th className="text-center py-2 px-3 font-semibold whitespace-nowrap border-r border-gray-200" colSpan={3}>סה״כ</th>
            </tr>
            <tr className="text-gray-400 border-b border-gray-200 bg-gray-50 text-[10px]">
              <th className="sticky right-0 bg-gray-50"></th>
              {data.months.map((m) => (
                <>
                  <th key={`${m}-s`} className="text-right py-1 px-2 font-medium border-r border-gray-200" title="צריך לחייב (פגישות)">צריך</th>
                  <th key={`${m}-i`} className="text-right py-1 px-2 font-medium" title="חויב — חשבון עסקה">חויב</th>
                  <th key={`${m}-p`} className="text-right py-1 px-2 font-medium" title="שולם בפועל">שולם</th>
                </>
              ))}
              <th className="text-right py-1 px-2 font-medium border-r border-gray-200">צריך</th>
              <th className="text-right py-1 px-2 font-medium">חויב</th>
              <th className="text-right py-1 px-2 font-medium">שולם</th>
            </tr>
          </thead>
          <tbody>
            {filteredBodies.map((b) => (
              <tr key={b.payingBodyId} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-3 font-medium sticky right-0 bg-white">
                  <div className="flex items-center gap-1.5">
                    <span>{b.payingBodyName}</span>
                    {!b.isComplete && (
                      <span title="גוף משלם לא שלם" className="text-amber-500">
                        <AlertTriangle className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  {b.taxId && <div className="text-[10px] text-gray-400">ח.פ {b.taxId}</div>}
                </td>
                {b.monthly.map((m) => (
                  <>
                    <td key={`${m.month}-s`} className="py-1 px-2 text-emerald-600 text-xs border-r border-gray-100">
                      {m.shouldBill > 0 ? money(m.shouldBill) : ''}
                    </td>
                    <td
                      key={`${m.month}-i`}
                      className={`py-1 px-2 text-xs ${m.shouldBill - m.issued > 100 ? 'bg-amber-50 text-amber-700' : 'text-indigo-600'}`}
                    >
                      {m.issued > 0 ? money(m.issued) : ''}
                    </td>
                    <td
                      key={`${m.month}-p`}
                      className={`py-1 px-2 text-xs ${m.issued - m.paid > 100 ? 'bg-rose-50 text-rose-600' : 'text-sky-600'}`}
                    >
                      {m.paid > 0 ? money(m.paid) : ''}
                    </td>
                  </>
                ))}
                <td className="py-2 px-2 font-bold text-emerald-600 text-xs border-r border-gray-200">{money(b.shouldBillTotal)}</td>
                <td className={`py-2 px-2 font-bold text-xs ${b.shouldBillTotal - b.issuedTotal > 100 ? 'text-amber-600' : 'text-indigo-600'}`}>
                  {money(b.issuedTotal)}
                </td>
                <td className={`py-2 px-2 font-bold text-xs ${b.issuedTotal - b.paidTotal > 100 ? 'text-rose-600' : 'text-sky-600'}`}>
                  {money(b.paidTotal)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-semibold">
              <td className="py-2 px-3 sticky right-0 bg-gray-100">סה״כ</td>
              {data.months.map((m) => {
                const s = filteredBodies.reduce((acc, b) => acc + (b.monthly.find((x) => x.month === m)?.shouldBill ?? 0), 0);
                const i = filteredBodies.reduce((acc, b) => acc + (b.monthly.find((x) => x.month === m)?.issued ?? 0), 0);
                const p = filteredBodies.reduce((acc, b) => acc + (b.monthly.find((x) => x.month === m)?.paid ?? 0), 0);
                return (
                  <>
                    <td key={`tf-${m}-s`} className="py-2 px-2 text-emerald-600 text-xs border-r border-gray-200">{money(s)}</td>
                    <td key={`tf-${m}-i`} className="py-2 px-2 text-indigo-600 text-xs">{money(i)}</td>
                    <td key={`tf-${m}-p`} className="py-2 px-2 text-sky-600 text-xs">{money(p)}</td>
                  </>
                );
              })}
              <td className="py-2 px-2 text-emerald-700 text-xs border-r border-gray-200">{money(filteredBodies.reduce((s, b) => s + b.shouldBillTotal, 0))}</td>
              <td className="py-2 px-2 text-indigo-700 text-xs">{money(filteredBodies.reduce((s, b) => s + b.issuedTotal, 0))}</td>
              <td className="py-2 px-2 text-sky-700 text-xs">{money(filteredBodies.reduce((s, b) => s + b.paidTotal, 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Orders without a paying body but with active cycles */}
      {missing.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <button
            onClick={() => setShowMissing(!showMissing)}
            className="w-full flex items-center justify-between text-sm hover:bg-gray-50 rounded-lg px-2 py-1.5"
          >
            <span className="flex items-center gap-2 text-rose-700">
              <AlertTriangle className="w-4 h-4" />
              {missing.length} הזמנות עם מחזורים פעילים ללא גוף משלם — דורש השלמה
            </span>
            {showMissing ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showMissing && (
            <div className="mt-2 space-y-1">
              {missing.map((o) => (
                <div key={o.orderId} className="flex items-start justify-between text-sm text-gray-700 px-2 py-1 border-b border-gray-50">
                  <div>
                    <span className="font-medium">{o.orderName || 'ללא שם'}</span>
                    {o.branchName && <span className="text-gray-400"> · {o.branchName}</span>}
                    {o.legacyPayingBody && <span className="text-gray-400"> · גוף משלם (טקסט): {o.legacyPayingBody}</span>}
                  </div>
                  <span className="text-rose-600 text-xs whitespace-nowrap">{o.activeCycles.length} מחזורים פעילים</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
