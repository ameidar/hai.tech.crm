import { useState, useMemo } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, Search, X, FileText, Filter, LayoutGrid, List, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { quotesApi, type Quote } from '../api/quotes';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonTable } from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';

const statusTabs = [
  { value: '', label: 'הכל' },
  { value: 'draft', label: 'טיוטה' },
  { value: 'sent', label: 'נשלחה' },
  { value: 'accepted', label: 'אושרה' },
  { value: 'rejected', label: 'נדחתה' },
];

const statusHebrew: Record<string, string> = {
  draft: 'טיוטה',
  sent: 'נשלחה',
  accepted: 'אושרה',
  rejected: 'נדחתה',
};

const statusBadgeClass: Record<string, string> = {
  draft: 'badge-warning',
  sent: 'badge-info',
  accepted: 'badge-success',
  rejected: 'badge-danger',
};

export default function Quotes() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const statusFilter = searchParams.get('status') || '';
  const searchQuery = searchParams.get('search') || '';

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    setSearchParams(newParams, { replace: true });
  };

  useMemo(() => {
    const timeout = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const { data: quotes, isLoading } = useQuery({
    queryKey: ['quotes', statusFilter, debouncedSearch],
    queryFn: () => quotesApi.list({
      status: statusFilter || undefined,
      search: debouncedSearch || undefined,
    }),
  });

  const hasActiveFilters = statusFilter || searchQuery;

  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('quotes-view') as 'grid' | 'list') || 'list'
  );
  const toggleViewMode = (m: 'grid' | 'list') => { setViewMode(m); localStorage.setItem('quotes-view', m); };

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const handleSort = (key: string) => setSortConfig(prev => prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  const SortTh = ({ label, k }: { label: string; k: string }) => {
    const active = sortConfig?.key === k;
    const Icon = active ? (sortConfig.direction === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return <th className="p-3 text-right font-medium text-gray-600 cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort(k)}><span className="inline-flex items-center gap-1">{label}<Icon size={13} className={active ? 'text-blue-600' : 'text-gray-400'} /></span></th>;
  };

  const sortedQuotes = useMemo(() => {
    if (!quotes || !sortConfig) return quotes || [];
    return [...quotes].sort((a, b) => {
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      switch (sortConfig.key) {
        case 'institution': return dir * String(a.institutionName ?? '').localeCompare(String(b.institutionName ?? ''), 'he');
        case 'status': return dir * String(a.status ?? '').localeCompare(String(b.status ?? ''));
        case 'total': return dir * ((Number(a.totalAmount) || 0) - (Number(b.totalAmount) || 0));
        case 'date': return dir * String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
        default: return 0;
      }
    });
  }, [quotes, sortConfig]);

  return (
    <>
      <PageHeader
        title="הצעות מחיר"
        subtitle={`${quotes?.length || 0} הצעות`}
        actions={
          <button onClick={() => navigate('/quotes/new')} className="btn btn-primary">
            <Plus size={18} />
            הצעה חדשה
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Filters */}
        <div className="mb-6 space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[150px] max-w-md">
              <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => updateFilter('search', e.target.value)}
                placeholder="חיפוש לפי שם מוסד..."
                className="form-input pr-10 w-full"
              />
            </div>
            <span className="text-sm text-gray-500 mr-auto">{sortedQuotes.length} הצעות</span>
            {hasActiveFilters && (
              <button onClick={() => { updateFilter('status', ''); updateFilter('search', ''); }} className="btn btn-secondary flex items-center gap-1">
                <X size={16} />נקה סינון
              </button>
            )}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              <button onClick={() => toggleViewMode('grid')} className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="כרטיסיות"><LayoutGrid size={16} /></button>
              <button onClick={() => toggleViewMode('list')} className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="שורות"><List size={16} /></button>
            </div>
          </div>

          {/* Status Tabs */}
          <div className="flex gap-1 border-b border-gray-200">
            {statusTabs.map((tab) => (
              <button key={tab.value} onClick={() => updateFilter('status', tab.value)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${statusFilter === tab.value ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <SkeletonTable rows={6} columns={6} />
        ) : sortedQuotes.length > 0 ? (
          <>
            {/* Card view */}
            <div className={`${viewMode === 'grid' ? 'grid' : 'hidden'} grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`}>
              {sortedQuotes.map((quote) => (
                <Link key={quote.id} to={`/quotes/${quote.id}`}
                  className="group bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all duration-200 hover:-translate-y-0.5 p-5 block">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-sm">
                        <FileText size={16} className="text-white" />
                      </div>
                      <div>
                        <div className="font-semibold text-blue-600 text-sm">#{quote.quoteNumber}</div>
                        <div className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors">{quote.institutionName}</div>
                      </div>
                    </div>
                    <span className={`badge ${statusBadgeClass[quote.status]}`}>{statusHebrew[quote.status]}</span>
                  </div>
                  <p className="text-sm text-gray-500 mb-3">{quote.contactName}</p>
                  <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                    <span className="font-semibold text-green-600">₪{Number(quote.totalAmount || 0).toLocaleString()}</span>
                    <span className="text-xs text-gray-400">{new Date(quote.createdAt).toLocaleDateString('he-IL')}</span>
                  </div>
                </Link>
              ))}
            </div>

            {/* List/table view */}
            <div className={`${viewMode === 'list' ? 'block' : 'hidden'} bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="p-3 text-right font-medium text-gray-600">מספר הצעה</th>
                      <SortTh label="מוסד" k="institution" />
                      <th className="p-3 text-right font-medium text-gray-600">איש קשר</th>
                      <SortTh label="סכום" k="total" />
                      <SortTh label="סטטוס" k="status" />
                      <SortTh label="תאריך" k="date" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sortedQuotes.map((quote) => (
                      <tr key={quote.id} className="cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => navigate(`/quotes/${quote.id}`)}>
                        <td className="p-3"><span className="text-blue-600 font-medium">#{quote.quoteNumber}</span></td>
                        <td className="p-3 font-medium text-gray-900">{quote.institutionName}</td>
                        <td className="p-3 text-gray-600">{quote.contactName}</td>
                        <td className="p-3 font-semibold text-green-600">₪{Number(quote.totalAmount || 0).toLocaleString()}</td>
                        <td className="p-3"><span className={`badge ${statusBadgeClass[quote.status]}`}>{statusHebrew[quote.status]}</span></td>
                        <td className="p-3 text-gray-600">{new Date(quote.createdAt).toLocaleDateString('he-IL')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<FileText size={40} />}
            title="אין הצעות מחיר"
            description="עדיין לא נוצרו הצעות מחיר. צור הצעה חדשה כדי להתחיל!"
            action={
              <button onClick={() => navigate('/quotes/new')} className="btn btn-primary">
                <Plus size={18} />
                הצעה ראשונה
              </button>
            }
          />
        )}
      </div>
    </>
  );
}
