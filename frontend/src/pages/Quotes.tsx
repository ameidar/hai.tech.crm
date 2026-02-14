import { useState, useMemo } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, Search, X, FileText, Filter } from 'lucide-react';
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

      <div className="flex-1 p-4 md:p-6 overflow-auto">
        {/* Filters */}
        <div className="mb-4 md:mb-6 space-y-4">
          <div className="flex flex-wrap gap-2 md:gap-4 items-center">
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
            {hasActiveFilters && (
              <button
                onClick={() => { updateFilter('status', ''); updateFilter('search', ''); }}
                className="btn btn-secondary flex items-center gap-1 min-h-[44px]"
              >
                <X size={16} />
                <span className="hidden md:inline">נקה סינון</span>
              </button>
            )}
          </div>

          {/* Status Tabs */}
          <div className="flex gap-1 border-b border-gray-200">
            {statusTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => updateFilter('status', tab.value)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  statusFilter === tab.value
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <SkeletonTable rows={6} columns={6} />
        ) : quotes && quotes.length > 0 ? (
          <>
            {/* Mobile card view */}
            <div className="md:hidden space-y-2">
              {quotes.map((quote) => (
                <Link
                  key={quote.id}
                  to={`/quotes/${quote.id}`}
                  className="block bg-white rounded-lg border border-gray-100 p-4 shadow-sm active:bg-gray-50"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-blue-600 text-sm">#{quote.quoteNumber}</span>
                    <span className={`badge text-xs ${statusBadgeClass[quote.status]}`}>
                      {statusHebrew[quote.status]}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{quote.institutionName}</p>
                  <p className="text-sm text-gray-500">{quote.contactName}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm font-semibold text-green-600">₪{Number(quote.totalAmount || 0).toLocaleString()}</span>
                    <span className="text-xs text-gray-500">{new Date(quote.createdAt).toLocaleDateString('he-IL')}</span>
                  </div>
                </Link>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>מספר הצעה</th>
                      <th>מוסד</th>
                      <th>איש קשר</th>
                      <th>סכום</th>
                      <th>סטטוס</th>
                      <th>תאריך</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((quote) => (
                      <tr
                        key={quote.id}
                        className="cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => navigate(`/quotes/${quote.id}`)}
                      >
                        <td>
                          <span className="text-blue-600 font-medium">#{quote.quoteNumber}</span>
                        </td>
                        <td className="font-medium">{quote.institutionName}</td>
                        <td className="text-gray-600">{quote.contactName}</td>
                        <td className="font-semibold text-green-600">
                          ₪{Number(quote.totalAmount || 0).toLocaleString()}
                        </td>
                        <td>
                          <span className={`badge ${statusBadgeClass[quote.status]}`}>
                            {statusHebrew[quote.status]}
                          </span>
                        </td>
                        <td className="text-gray-600">
                          {new Date(quote.createdAt).toLocaleDateString('he-IL')}
                        </td>
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
