import { useState } from 'react';
import { FileText, Building2, Search, Filter, ChevronUp, ChevronDown, ChevronsUpDown, LayoutGrid, List, MapPin, Phone, RefreshCcw, Plus, Pencil, Trash2, CheckSquare, Square, X } from 'lucide-react';
import { useInstitutionalOrders, useCreateInstitutionalOrder, useUpdateInstitutionalOrder, useDeleteInstitutionalOrder, useBranches } from '../hooks/useApi';
import type { InstitutionalOrderData } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal';
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

const EMPTY_FORM: Partial<InstitutionalOrderData> = {
  branchId: '',
  orderNumber: '',
  startDate: '',
  endDate: '',
  pricePerMeeting: 0,
  estimatedMeetings: undefined,
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  status: 'draft',
  notes: '',
};

export default function InstitutionalOrders() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('institutional-orders-view') as 'grid' | 'list') || 'list'
  );
  const toggleViewMode = (m: 'grid' | 'list') => { setViewMode(m); localStorage.setItem('institutional-orders-view', m); };
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const handleSort = (key: string) => setSortConfig(prev => prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  const SortIcon = ({ k }: { k: string }) => {
    if (sortConfig?.key !== k) return <ChevronsUpDown size={13} className="text-gray-400 inline ms-1" />;
    return sortConfig.direction === 'asc' ? <ChevronUp size={13} className="text-blue-600 inline ms-1" /> : <ChevronDown size={13} className="text-blue-600 inline ms-1" />;
  };

  // CRUD state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editItem, setEditItem] = useState<InstitutionalOrderRow | null>(null);
  const [deleteItem, setDeleteItem] = useState<InstitutionalOrderRow | null>(null);
  const [form, setForm] = useState<Partial<InstitutionalOrderData>>(EMPTY_FORM);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data, isLoading } = useInstitutionalOrders({ status: statusFilter || undefined, page, limit: 50 });
  const { data: branchesData } = useBranches();
  const branches = branchesData || [];

  const createOrder = useCreateInstitutionalOrder();
  const updateOrder = useUpdateInstitutionalOrder();
  const deleteOrder = useDeleteInstitutionalOrder();

  const orders: InstitutionalOrderRow[] = (data as any)?.data || [];
  const pagination = (data as any)?.pagination;

  // Client-side search + sort
  const filtered = (() => {
    let list = orders.filter((o) => {
      if (!searchFilter) return true;
      const s = searchFilter.toLowerCase();
      return o.orderNumber?.toLowerCase().includes(s) || o.branch?.name.toLowerCase().includes(s) || o.contactName.toLowerCase().includes(s) || o.contactPhone.includes(s);
    });
    if (sortConfig) {
      list = [...list].sort((a, b) => {
        const dir = sortConfig.direction === 'asc' ? 1 : -1;
        switch (sortConfig.key) {
          case 'branch': return dir * String(a.branch?.name ?? '').localeCompare(String(b.branch?.name ?? ''), 'he');
          case 'status': return dir * String(a.status ?? '').localeCompare(String(b.status ?? ''), 'he');
          case 'startDate': return dir * String(a.startDate ?? '').localeCompare(String(b.startDate ?? ''));
          case 'total': return dir * ((Number(a.estimatedTotal || a.totalAmount) || 0) - (Number(b.estimatedTotal || b.totalAmount) || 0));
          default: return 0;
        }
      });
    }
    return list;
  })();

  const allSelected = filtered.length > 0 && filtered.every(o => selectedIds.has(o.id));
  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(o => o.id)));
  };
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openAdd = () => { setForm(EMPTY_FORM); setShowAddModal(true); };
  const openEdit = (o: InstitutionalOrderRow) => {
    setForm({
      branchId: o.branch?.id || '',
      orderNumber: o.orderNumber || '',
      startDate: o.startDate?.slice(0, 10) || '',
      endDate: o.endDate?.slice(0, 10) || '',
      pricePerMeeting: o.pricePerMeeting,
      estimatedMeetings: o.estimatedMeetings,
      contactName: o.contactName,
      contactPhone: o.contactPhone,
      contactEmail: o.contactEmail || '',
      status: o.status,
      notes: o.notes || '',
    });
    setEditItem(o);
  };

  const handleSubmit = async () => {
    if (!form.branchId || !form.startDate || !form.endDate || !form.contactName || !form.contactPhone || !form.pricePerMeeting) return;
    try {
      if (editItem) {
        await updateOrder.mutateAsync({ id: editItem.id, data: form as InstitutionalOrderData });
        setEditItem(null);
      } else {
        await createOrder.mutateAsync(form as InstitutionalOrderData);
        setShowAddModal(false);
      }
      setForm(EMPTY_FORM);
    } catch (e) { console.error(e); }
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    try {
      await deleteOrder.mutateAsync(deleteItem.id);
      setDeleteItem(null);
      setSelectedIds(prev => { const n = new Set(prev); n.delete(deleteItem.id); return n; });
    } catch (e) { console.error(e); }
  };

  const handleBulkDelete = async () => {
    for (const id of selectedIds) {
      await deleteOrder.mutateAsync(id).catch(() => {});
    }
    setSelectedIds(new Set());
  };

  const OrderForm = () => (
    <div className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">סניף *</label>
          <select className="form-input w-full" value={form.branchId} onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))}>
            <option value="">בחר סניף</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">מספר הזמנה</label>
          <input className="form-input w-full" value={form.orderNumber || ''} onChange={e => setForm(f => ({ ...f, orderNumber: e.target.value }))} placeholder="INV-001" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">תאריך התחלה *</label>
          <input type="date" className="form-input w-full" value={form.startDate || ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">תאריך סיום *</label>
          <input type="date" className="form-input w-full" value={form.endDate || ''} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">מחיר לפגישה (₪) *</label>
          <input type="number" className="form-input w-full" value={form.pricePerMeeting || ''} onChange={e => setForm(f => ({ ...f, pricePerMeeting: Number(e.target.value) }))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">מספר פגישות משוער</label>
          <input type="number" className="form-input w-full" value={form.estimatedMeetings || ''} onChange={e => setForm(f => ({ ...f, estimatedMeetings: Number(e.target.value) || undefined }))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">איש קשר *</label>
          <input className="form-input w-full" value={form.contactName || ''} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">טלפון *</label>
          <input className="form-input w-full" dir="ltr" value={form.contactPhone || ''} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">מייל</label>
          <input type="email" className="form-input w-full" dir="ltr" value={form.contactEmail || ''} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">סטטוס</label>
          <select className="form-input w-full" value={form.status || 'draft'} onChange={e => setForm(f => ({ ...f, status: e.target.value as InstitutionalOrderData['status'] }))}>
            <option value="draft">טיוטה</option>
            <option value="active">פעיל</option>
            <option value="completed">הושלם</option>
            <option value="cancelled">בוטל</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">הערות</label>
        <textarea className="form-input w-full" rows={3} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </div>
      <div className="flex justify-end gap-3 pt-2 border-t">
        <button type="button" className="btn btn-secondary" onClick={() => { setShowAddModal(false); setEditItem(null); }}>ביטול</button>
        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={createOrder.isPending || updateOrder.isPending}>
          {createOrder.isPending || updateOrder.isPending ? 'שומר...' : editItem ? 'שמור שינויים' : 'צור הזמנה'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="הזמנות מוסדיות"
        subtitle={`${pagination?.total || orders.length} הזמנות`}
        action={<button className="btn btn-primary flex items-center gap-2" onClick={openAdd}><Plus size={16} />הוסף הזמנה</button>}
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="mb-4 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm">
            <button onClick={() => setSelectedIds(new Set())}><X size={16} className="text-blue-600" /></button>
            <span className="text-blue-700 font-medium">{selectedIds.size} נבחרו</span>
            <button className="btn btn-danger btn-sm flex items-center gap-1 mr-auto" onClick={handleBulkDelete}>
              <Trash2 size={14} />מחק נבחרים
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-3 items-center">
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
          <span className="text-sm text-gray-500 mr-auto">{filtered.length} הזמנות</span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => toggleViewMode('grid')} className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="כרטיסיות"><LayoutGrid size={16} /></button>
            <button onClick={() => toggleViewMode('list')} className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="שורות"><List size={16} /></button>
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
            {/* Card / Grid view */}
            <div className={`${viewMode === 'grid' ? 'grid' : 'hidden'} grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-4`}>
              {filtered.map((order) => (
                <div key={order.id} className={`group bg-white rounded-xl border shadow-sm hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 p-5 ${selectedIds.has(order.id) ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-100 hover:border-gray-200'}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={selectedIds.has(order.id)} onChange={() => toggleSelect(order.id)} className="rounded" onClick={e => e.stopPropagation()} />
                      <div className={`w-10 h-10 bg-gradient-to-br ${order.status === 'active' ? 'from-green-500 to-green-600' : order.status === 'completed' ? 'from-blue-500 to-blue-600' : order.status === 'cancelled' ? 'from-red-400 to-red-500' : 'from-gray-400 to-gray-500'} rounded-xl flex items-center justify-center shadow-sm`}>
                        <FileText size={16} className="text-white" />
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">{order.branch?.name || '-'}</div>
                        {order.orderNumber && <div className="text-xs text-gray-500">#{order.orderNumber}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusColors[order.status]}`}>{statusLabels[order.status]}</span>
                      <button onClick={() => openEdit(order)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors opacity-0 group-hover:opacity-100"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteItem(order)} className="p-1 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-sm mb-3">
                    {order.branch?.city && <p className="flex items-center gap-2 text-gray-600"><MapPin size={13} className="text-gray-400" />{order.branch.city}</p>}
                    <p className="flex items-center gap-2 text-gray-600"><Phone size={13} className="text-gray-400" /><span dir="ltr">{order.contactPhone}</span></p>
                    {order._count?.cycles != null && <p className="flex items-center gap-2 text-gray-600"><RefreshCcw size={13} className="text-gray-400" />{order._count.cycles} מחזורים</p>}
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-gray-50 text-sm">
                    <span className="font-semibold text-green-600">{formatCurrency(order.estimatedTotal || order.totalAmount)}</span>
                    <span className="text-xs text-gray-400">{formatDate(order.startDate)} — {formatDate(order.endDate)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Table view */}
            <div className={`${viewMode === 'list' ? 'block' : 'hidden'} bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-3">
                        <button onClick={toggleSelectAll}>
                          {allSelected ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} className="text-gray-400" />}
                        </button>
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">מס׳ הזמנה</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 cursor-pointer hover:bg-gray-100 select-none" onClick={() => handleSort('branch')}>סניף<SortIcon k="branch" /></th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 cursor-pointer hover:bg-gray-100 select-none" onClick={() => handleSort('status')}>סטטוס<SortIcon k="status" /></th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">איש קשר</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">טלפון</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 cursor-pointer hover:bg-gray-100 select-none" onClick={() => handleSort('startDate')}>תאריך התחלה<SortIcon k="startDate" /></th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">תאריך סיום</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">מחיר/פגישה</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 cursor-pointer hover:bg-gray-100 select-none" onClick={() => handleSort('total')}>סה״כ משוער<SortIcon k="total" /></th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">תשלום</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">מחזורים</th>
                      <th className="px-4 py-3 w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map((order) => (
                      <tr key={order.id} className={`hover:bg-gray-50 transition-colors group ${selectedIds.has(order.id) ? 'bg-blue-50' : ''}`}>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={selectedIds.has(order.id)} onChange={() => toggleSelect(order.id)} className="rounded" />
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{order.orderNumber || '-'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Building2 size={14} className="text-gray-400" />
                            <span className="text-gray-800">{order.branch?.name || '-'}</span>
                          </div>
                          {order.branch?.city && <span className="text-xs text-gray-500">{order.branch.city}</span>}
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
                        <td className="px-4 py-3">
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(order)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="ערוך"><Pencil size={14} /></button>
                            <button onClick={() => setDeleteItem(order)} className="p-1 text-gray-400 hover:text-red-500 transition-colors" title="מחק"><Trash2 size={14} /></button>
                          </div>
                        </td>
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
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!pagination.hasPrev} className="btn btn-secondary btn-sm">הקודם</button>
                  <button onClick={() => setPage(p => p + 1)} disabled={!pagination.hasNext} className="btn btn-secondary btn-sm">הבא</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={<FileText size={40} />}
            title="אין הזמנות מוסדיות"
            description="לחץ על 'הוסף הזמנה' כדי ליצור הזמנה חדשה."
            action={<button className="btn btn-primary flex items-center gap-2" onClick={openAdd}><Plus size={16} />הוסף הזמנה</button>}
          />
        )}
      </div>

      {/* Add Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="הזמנה מוסדית חדשה">
        <OrderForm />
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={!!editItem} onClose={() => setEditItem(null)} title="עריכת הזמנה מוסדית">
        <OrderForm />
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDeleteModal
        isOpen={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleDelete}
        itemName={deleteItem?.branch?.name || deleteItem?.orderNumber}
        warningText={deleteItem?._count?.cycles ? `להזמנה יש ${deleteItem._count.cycles} מחזורים מקושרים` : undefined}
        isLoading={deleteOrder.isPending}
      />
    </>
  );
}
