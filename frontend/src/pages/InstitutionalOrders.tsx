import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Building2, Search, Filter } from 'lucide-react';
import api from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import type { OrderStatus } from '../types';

interface InstitutionalOrderRow {
  id: string;
  orderNumber?: string;
  orderDate?: string;
  startDate: string;
  endDate: string;
  pricePerMeeting: number;
  estimatedMeetings?: number;
  estimatedTotal?: number;
  totalAmount?: number;
  paidAmount?: number;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  status: OrderStatus;
  paymentStatus?: string;
  invoiceNumber?: string;
  notes?: string;
  createdAt: string;
  branch?: { id: string; name: string; city?: string; type: string };
  _count?: { cycles: number };
}

const statusColors: Record<OrderStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 border-gray-200',
  active: 'bg-green-100 text-green-700 border-green-200',
  completed: 'bg-blue-100 text-blue-700 border-blue-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
};

const statusLabels: Record<OrderStatus, string> = {
  draft: 'טיוטה',
  active: 'פעיל',
  completed: 'הושלם',
  cancelled: 'בוטל',
};

const paymentStatusLabels: Record<string, string> = {
  unpaid: 'לא שולם',
  partial: 'שולם חלקית',
  paid: 'שולם',
};

const paymentStatusColors: Record<string, string> = {
  unpaid: 'text-red-600',
  partial: 'text-yellow-600',
  paid: 'text-green-600',
};

function formatDate(dateStr?: string) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('he-IL');
}

function formatCurrency(amount?: number | null) {
  if (amount == null) return '-';
  return `₪${Number(amount).toLocaleString('he-IL')}`;
}

export default function InstitutionalOrders() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', '50');
  if (statusFilter) params.set('status', statusFilter);

  const { data, isLoading } = useQuery({
    queryKey: ['institutional-orders', page, statusFilter],
    queryFn: async () => {
      const res = await api.get(`/institutional-orders?${params.toString()}`);
      // Handle paginated response
      if (res.data?.data) return res.data;
      return { data: res.data, pagination: null };
    },
  });

  const orders: InstitutionalOrderRow[] = data?.data || [];
  const pagination = data?.pagination;

  // Client-side search filter
  const filtered = orders.filter((o) => {
    if (!searchFilter) return true;
    const s = searchFilter.toLowerCase();
    return (
      o.orderNumber?.toLowerCase().includes(s) ||
      o.branch?.name.toLowerCase().includes(s) ||
      o.contactName.toLowerCase().includes(s) ||
      o.contactPhone.includes(s)
    );
  });

  return (
    <>
      <PageHeader
        title="הזמנות מוסדיות"
        subtitle={`${pagination?.total || orders.length} הזמנות`}
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Filters */}
        <div className="mb-4 flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="חיפוש לפי מספר הזמנה, סניף, איש קשר..."
              className="form-input pr-10 w-full"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="form-input w-40"
            >
              <option value="">כל הסטטוסים</option>
              <option value="draft">טיוטה</option>
              <option value="active">פעיל</option>
              <option value="completed">הושלם</option>
              <option value="cancelled">בוטל</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <Loading />
        ) : filtered.length > 0 ? (
          <>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-right px-4 py-3 font-medium text-gray-600">מס׳ הזמנה</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">סניף</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">סטטוס</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">איש קשר</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">טלפון</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">תאריך התחלה</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">תאריך סיום</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">מחיר/פגישה</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">סה״כ משוער</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">תשלום</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">מחזורים</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map((order) => (
                      <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {order.orderNumber || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Building2 size={14} className="text-gray-400" />
                            <span className="text-gray-800">{order.branch?.name || '-'}</span>
                          </div>
                          {order.branch?.city && (
                            <span className="text-xs text-gray-500">{order.branch.city}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusColors[order.status]}`}>
                            {statusLabels[order.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{order.contactName}</td>
                        <td className="px-4 py-3 text-gray-700" dir="ltr">{order.contactPhone}</td>
                        <td className="px-4 py-3 text-gray-700">{formatDate(order.startDate)}</td>
                        <td className="px-4 py-3 text-gray-700">{formatDate(order.endDate)}</td>
                        <td className="px-4 py-3 text-gray-700">{formatCurrency(order.pricePerMeeting)}</td>
                        <td className="px-4 py-3 text-gray-700">{formatCurrency(order.estimatedTotal || order.totalAmount)}</td>
                        <td className="px-4 py-3">
                          {order.paymentStatus ? (
                            <span className={`text-xs font-medium ${paymentStatusColors[order.paymentStatus] || ''}`}>
                              {paymentStatusLabels[order.paymentStatus] || order.paymentStatus}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{order._count?.cycles || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
                <span>עמוד {pagination.page} מתוך {pagination.totalPages} ({pagination.total} הזמנות)</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={!pagination.hasPrev}
                    className="btn btn-secondary btn-sm"
                  >
                    הקודם
                  </button>
                  <button
                    onClick={() => setPage(p => p + 1)}
                    disabled={!pagination.hasNext}
                    className="btn btn-secondary btn-sm"
                  >
                    הבא
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={<FileText size={40} />}
            title="אין הזמנות מוסדיות"
            description="עדיין לא נוצרו הזמנות מוסדיות. ניתן ליצור הזמנות דרך דף הסניפים."
          />
        )}
      </div>
    </>
  );
}
