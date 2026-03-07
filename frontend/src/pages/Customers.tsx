import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, Phone, Mail, MapPin, Users, Trash2, LayoutGrid, List, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useCustomers, useCreateCustomer, useDeleteCustomer } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCardGrid } from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ViewSelector from '../components/ViewSelector';
import type { Customer } from '../types';

type SortConfig = { key: string; direction: 'asc' | 'desc' } | null;

function SortableTh({ label, sortKey, sortConfig, onSort, align = 'right' }: {
  label: string; sortKey: string; sortConfig: SortConfig; onSort: (k: string) => void; align?: string;
}) {
  const active = sortConfig?.key === sortKey;
  const Icon = active ? (sortConfig?.direction === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th className={`p-3 font-medium text-gray-600 cursor-pointer select-none hover:bg-gray-100 transition-colors text-${align}`} onClick={() => onSort(sortKey)}>
      <span className="inline-flex items-center gap-1">{label}<Icon size={13} className={active ? 'text-blue-600' : 'text-gray-400'} /></span>
    </th>
  );
}

export default function Customers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('customers-view') as 'grid' | 'list') || 'grid'
  );
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  const toggleViewMode = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('customers-view', mode);
  };

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }
    );
  };

  const [page, setPage] = useState(1);

  // Read search from URL
  const search = searchParams.get('search') || '';
  const setSearch = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) newParams.set('search', value); else newParams.delete('search');
    setSearchParams(newParams, { replace: true });
    setPage(1); // reset page on new search
  };

  const { data: customersResult, isLoading } = useCustomers({ search, page });
  const customers = customersResult?.data ?? [];
  const pagination = customersResult?.pagination;
  const createCustomer = useCreateCustomer();
  const deleteCustomer = useDeleteCustomer();

  const handleDeleteCustomer = async (id: string) => {
    if (confirm('האם למחוק את הלקוח? פעולה זו לא ניתנת לביטול.')) {
      try {
        await deleteCustomer.mutateAsync(id);
      } catch (error) {
        console.error('Failed to delete customer:', error);
        alert('שגיאה במחיקת הלקוח');
      }
    }
  };

  const handleAddCustomer = async (data: Partial<Customer>) => {
    try {
      await createCustomer.mutateAsync(data);
      setShowAddModal(false);
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.response?.data?.error || 'שגיאה ביצירת לקוח';
      alert(message);
    }
  };

  const displayList = (() => {
    let list = [...customers];
    if (sortConfig) {
      list = [...list].sort((a, b) => {
        let aVal: any, bVal: any;
        switch (sortConfig.key) {
          case 'name':
            return sortConfig.direction === 'asc'
              ? String(a.name ?? '').localeCompare(String(b.name ?? ''), 'he')
              : String(b.name ?? '').localeCompare(String(a.name ?? ''), 'he');
          case 'city':
            return sortConfig.direction === 'asc'
              ? String(a.city ?? '').localeCompare(String(b.city ?? ''), 'he')
              : String(b.city ?? '').localeCompare(String(a.city ?? ''), 'he');
          case 'students': aVal = a._count?.students ?? 0; bVal = b._count?.students ?? 0; break;
          default: return 0;
        }
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }
    return list;
  })();

  return (
    <>
      <PageHeader
        title="לקוחות"
        subtitle={pagination ? `${pagination.total.toLocaleString()} לקוחות` : `${displayList.length} לקוחות`}
        actions={
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus size={18} /> לקוח חדש
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Search & Controls */}
        <div className="mb-6 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="חיפוש לפי שם, טלפון או אימייל..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input pr-10"
            />
          </div>
          <span className="text-sm text-gray-500 mr-auto">
            {pagination ? `${((page-1)*100+1).toLocaleString()}–${Math.min(page*100, pagination.total).toLocaleString()} מתוך ${pagination.total.toLocaleString()} לקוחות` : `${displayList.length} לקוחות`}
          </span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => toggleViewMode('grid')} className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="כרטיסיות"><LayoutGrid size={16} /></button>
            <button onClick={() => toggleViewMode('list')} className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="שורות"><List size={16} /></button>
          </div>
          <ViewSelector entity="customers" onApplyView={() => {}} />
        </div>

        {/* Content */}
        {isLoading ? (
          <SkeletonCardGrid count={6} />
        ) : displayList.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
              {displayList.map((customer) => (
                <CustomerCard key={customer.id} customer={customer} onDelete={handleDeleteCustomer} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <SortableTh label="שם" sortKey="name" sortConfig={sortConfig} onSort={handleSort} />
                    <th className="p-3 text-right font-medium text-gray-600">טלפון</th>
                    <th className="p-3 text-right font-medium text-gray-600">מייל</th>
                    <SortableTh label="עיר" sortKey="city" sortConfig={sortConfig} onSort={handleSort} />
                    <SortableTh label="תלמידים" sortKey="students" sortConfig={sortConfig} onSort={handleSort} align="center" />
                    <th className="p-3 text-center font-medium text-gray-600">תשלומים</th>
                    <th className="p-3 text-right font-medium text-gray-600">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {displayList.map((customer) => (
                    <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                      <td className="p-3">
                        <Link to={`/customers/${customer.id}`} className="flex items-center gap-2 group">
                          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0">
                            {customer.name.charAt(0)}
                          </div>
                          <span className="font-medium text-gray-900 group-hover:text-blue-600">{customer.name}</span>
                        </Link>
                      </td>
                      <td className="p-3 text-gray-600 dir-ltr" dir="ltr">{customer.phone}</td>
                      <td className="p-3 text-gray-600 max-w-[160px] truncate" dir="ltr">{customer.email}</td>
                      <td className="p-3 text-gray-600">{customer.city || '-'}</td>
                      <td className="p-3 text-center">
                        <span className="inline-flex items-center gap-1 text-blue-600 font-medium">
                          <Users size={13} />{customer._count?.students ?? 0}
                        </span>
                      </td>
                      <td className="p-3 text-center text-gray-600">
                        {customer.payments && customer.payments.length > 0
                          ? <span className="text-indigo-600">🎓 {customer.payments.length}</span>
                          : '-'}
                      </td>
                      <td className="p-3">
                        <button onClick={() => handleDeleteCustomer(customer.id)} className="text-red-400 hover:text-red-600 transition-colors" title="מחק"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <EmptyState
            icon={<Users size={40} />}
            title="אין לקוחות"
            description="עדיין לא נוספו לקוחות למערכת. התחל להוסיף לקוחות כדי לנהל אותם!"
            action={
              <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                <Plus size={18} /> הוסף לקוח ראשון
              </button>
            }
          />
        )}
        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between text-sm text-gray-600">
            <span>עמוד {page} מתוך {pagination.totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!pagination.hasPrev} className="btn btn-secondary btn-sm">הקודם</button>
              <span className="flex items-center px-3 py-1 bg-blue-600 text-white rounded-lg font-medium">{page}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={!pagination.hasNext} className="btn btn-secondary btn-sm">הבא</button>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="לקוח חדש">
        <CustomerForm onSubmit={handleAddCustomer} onCancel={() => setShowAddModal(false)} isLoading={createCustomer.isPending} />
      </Modal>
    </>
  );
}

// Customer Card Component
function CustomerCard({ customer, onDelete }: { customer: Customer; onDelete: (id: string) => void }) {
  return (
    <div className="group relative bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all duration-200 hover:-translate-y-0.5">
      <Link to={`/customers/${customer.id}`} className="block p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-lg font-bold text-white">{customer.name.charAt(0)}</span>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-lg group-hover:text-blue-600 transition-colors">{customer.name}</h3>
              {customer.city && (
                <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                  <MapPin size={13} className="text-gray-400" />{customer.city}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {customer.payments && customer.payments.length > 0 && (
              <span title="רכש קורס דיגיטלי" className="text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-full text-sm">🎓</span>
            )}
            <div className="flex items-center gap-1.5 text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full text-sm font-medium">
              <Users size={14} /><span>{customer._count?.students || 0}</span>
            </div>
          </div>
        </div>
        <div className="space-y-2.5 text-sm">
          <p className="flex items-center gap-2.5 text-gray-600">
            <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center"><Phone size={14} className="text-gray-500" /></div>
            <span dir="ltr" className="text-gray-700">{customer.phone}</span>
          </p>
          <p className="flex items-center gap-2.5 text-gray-600">
            <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center"><Mail size={14} className="text-gray-500" /></div>
            <span dir="ltr" className="truncate text-gray-700">{customer.email}</span>
          </p>
        </div>
      </Link>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (window.confirm(`האם למחוק את הלקוח "${customer.name}"?`)) onDelete(customer.id); }}
        className="absolute top-3 left-3 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
        title="מחק לקוח"
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
}

// Customer Form Component
interface CustomerFormProps {
  onSubmit: (data: Partial<Customer>) => void;
  onCancel: () => void;
  isLoading?: boolean;
  initialData?: Customer;
}

function CustomerForm({ onSubmit, onCancel, isLoading, initialData }: CustomerFormProps) {
  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    email: initialData?.email || '',
    phone: initialData?.phone || '',
    address: initialData?.address || '',
    city: initialData?.city || '',
    notes: initialData?.notes || '',
  });

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSubmit(formData); };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="form-label">שם *</label>
          <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="form-input" required />
        </div>
        <div>
          <label className="form-label">טלפון *</label>
          <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="form-input" dir="ltr" required />
        </div>
        <div>
          <label className="form-label">אימייל</label>
          <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="form-input" dir="ltr" />
        </div>
        <div>
          <label className="form-label">כתובת</label>
          <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="form-input" />
        </div>
        <div>
          <label className="form-label">עיר</label>
          <input type="text" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className="form-input" />
        </div>
        <div className="col-span-2">
          <label className="form-label">הערות</label>
          <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="form-input" rows={3} />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">ביטול</button>
        <button type="submit" className="btn btn-primary" disabled={isLoading}>{isLoading ? 'שומר...' : 'שמור'}</button>
      </div>
    </form>
  );
}
