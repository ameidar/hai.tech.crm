import { useEffect, useMemo, useState } from 'react';
import { Search, GitMerge, AlertTriangle, ArrowLeft } from 'lucide-react';
import Modal from './ui/Modal';
import api from '../api/client';
import { useCustomerRelationCounts, useMergeCustomers } from '../hooks/useApi';
import type { Customer } from '../types';

interface LookupItem {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
}

// Scalar fields that participate in the merge, with Hebrew labels. Order = display order.
const FIELDS: { key: keyof Customer; label: string }[] = [
  { key: 'name', label: 'שם' },
  { key: 'phone', label: 'טלפון' },
  { key: 'email', label: 'אימייל' },
  { key: 'city', label: 'עיר' },
  { key: 'address', label: 'כתובת' },
  { key: 'source', label: 'מקור' },
  { key: 'leadStatus', label: 'סטטוס ליד' },
  { key: 'notes', label: 'הערות' },
  { key: 'lmsUsername', label: 'שם משתמש LMS' },
];

const COUNT_LABELS: { key: string; label: string }[] = [
  { key: 'payments', label: 'תשלומים' },
  { key: 'paymentLinks', label: 'קישורי תשלום' },
  { key: 'students', label: 'תלמידים' },
  { key: 'quotes', label: 'הצעות מחיר' },
  { key: 'leadAppointments', label: 'פגישות ליד' },
  { key: 'upsellLeads', label: 'לידים לאפסייל' },
  { key: 'campaignRecipients', label: 'נמעני קמפיין' },
  { key: 'facebookLeads', label: 'לידים מפייסבוק' },
];

function val(c: Customer | undefined, key: keyof Customer): string {
  const v = c?.[key];
  return v == null ? '' : String(v);
}

export default function MergeCustomerModal({
  keeper,
  onClose,
  onMerged,
}: {
  keeper: Customer;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [source, setSource] = useState<Customer | null>(null);
  // For fields where both differ: true = take source value, false = keep keeper value.
  const [takeSource, setTakeSource] = useState<Record<string, boolean>>({});

  const merge = useMergeCustomers();
  const { data: sourceCounts } = useCustomerRelationCounts(source?.id, !!source);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/customers/lookup', { params: { q } });
        if (!cancelled) setResults((res.data.items || []).filter((i: LookupItem) => i.id !== keeper.id));
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, keeper.id]);

  const pickSource = async (item: LookupItem) => {
    try {
      const res = await api.get(`/customers/${item.id}`);
      setSource(res.data);
      setTakeSource({});
    } catch {
      alert('שגיאה בטעינת הלקוח שנבחר');
    }
  };

  // Fields where both sides have a value and they differ — these need a choice.
  const conflicts = useMemo(() => {
    if (!source) return [];
    return FIELDS.filter((f) => {
      const a = val(keeper, f.key);
      const b = val(source, f.key);
      return a && b && a !== b;
    });
  }, [keeper, source]);

  const totalMoved = sourceCounts ? Object.values(sourceCounts).reduce((a, b) => a + b, 0) : 0;

  const handleMerge = async () => {
    if (!source) return;
    const overrides: Record<string, string | null> = {};
    for (const f of conflicts) {
      if (takeSource[f.key]) overrides[f.key] = val(source, f.key);
    }
    try {
      await merge.mutateAsync({ keepId: keeper.id, sourceId: source.id, overrides });
      onMerged();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'מיזוג הלקוחות נכשל');
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="מיזוג לקוח כפול" size="lg">
      <div className="space-y-4">
        <div className="text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2">
          <GitMerge size={18} className="text-blue-600 shrink-0 mt-0.5" />
          <span>
            הלקוח <b>{keeper.name}</b> יישאר. בחר את הלקוח הכפול שיתמזג לתוכו — כל התשלומים, התלמידים,
            הקישורים והלידים שלו יועברו ללקוח הזה, והרשומה הכפולה תימחק.
          </span>
        </div>

        {!source ? (
          <>
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חפש לקוח כפול לפי שם / טלפון / אימייל..."
                className="form-input w-full pr-9"
              />
            </div>
            {searching && <div className="text-xs text-gray-400">מחפש...</div>}
            <div className="max-h-64 overflow-y-auto divide-y border rounded-lg">
              {results.length === 0 && query.trim().length >= 2 && !searching ? (
                <div className="p-4 text-center text-sm text-gray-400">לא נמצאו לקוחות תואמים</div>
              ) : (
                results.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => pickSource(item)}
                    className="w-full text-right px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-2"
                  >
                    <span className="font-medium">{item.name}</span>
                    <span className="text-xs text-gray-400" dir="ltr">{item.phone || item.email || ''}</span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setSource(null)}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
            >
              <ArrowLeft size={14} /> בחר לקוח כפול אחר
            </button>

            {/* Counts that will move */}
            <div className="border rounded-lg p-3">
              <div className="text-sm font-medium mb-2">
                יועברו מ-<b>{source.name}</b> אל <b>{keeper.name}</b>
                {totalMoved > 0 ? '' : ' (אין רשומות מקושרות)'}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                {COUNT_LABELS.map(({ key, label }) => {
                  const n = (sourceCounts as any)?.[key] ?? 0;
                  if (!n) return null;
                  return (
                    <span key={key}>
                      {label}: <b>{n}</b>
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Field comparison */}
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[100px_1fr_1fr] text-xs font-medium bg-gray-50 border-b">
                <div className="p-2">שדה</div>
                <div className="p-2">נשמר ({keeper.name})</div>
                <div className="p-2">כפילות ({source.name})</div>
              </div>
              {FIELDS.map((f) => {
                const a = val(keeper, f.key);
                const b = val(source, f.key);
                if (!a && !b) return null;
                const isConflict = a && b && a !== b;
                const filledFromSource = !a && b;
                return (
                  <div key={f.key} className="grid grid-cols-[100px_1fr_1fr] text-xs border-b last:border-b-0">
                    <div className="p-2 text-gray-500">{f.label}</div>
                    <label className={`p-2 flex items-start gap-1.5 ${isConflict ? 'cursor-pointer' : ''}`}>
                      {isConflict && (
                        <input
                          type="radio"
                          checked={!takeSource[f.key]}
                          onChange={() => setTakeSource((s) => ({ ...s, [f.key]: false }))}
                          className="mt-0.5"
                        />
                      )}
                      <span className={!a ? 'text-gray-300' : ''}>{a || '—'}</span>
                    </label>
                    <label className={`p-2 flex items-start gap-1.5 ${isConflict ? 'cursor-pointer' : ''}`}>
                      {isConflict && (
                        <input
                          type="radio"
                          checked={!!takeSource[f.key]}
                          onChange={() => setTakeSource((s) => ({ ...s, [f.key]: true }))}
                          className="mt-0.5"
                        />
                      )}
                      <span className={filledFromSource ? 'text-green-700' : !b ? 'text-gray-300' : ''}>
                        {b || '—'}
                        {filledFromSource && <span className="text-[10px] text-green-600 mr-1">(ייוסף)</span>}
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>

            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              פעולה זו אינה הפיכה — הרשומה הכפולה תימחק לצמיתות לאחר העברת הנתונים.
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="btn btn-secondary">ביטול</button>
              <button onClick={handleMerge} disabled={merge.isPending} className="btn btn-primary">
                <GitMerge size={16} />
                {merge.isPending ? 'ממזג...' : 'מזג לקוחות'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
