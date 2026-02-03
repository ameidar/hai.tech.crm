import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Phone, Mail, MapPin, Users, Trash2 } from 'lucide-react';
import { useCustomers, useCreateCustomer, useDeleteCustomer } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCardGrid } from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ViewSelector from '../components/ViewSelector';
import type { Customer } from '../types';

export default function Customers() {
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: customers, isLoading } = useCustomers({ search });
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
    } catch (error) {
      console.error('Failed to create customer:', error);
    }
  };

  return (
    <>
      <PageHeader
        title="לקוחות"
        subtitle={`${customers?.length || 0} לקוחות`}
        actions={
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus size={18} />
            לקוח חדש
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Search & Views */}
        <div className="mb-6 flex gap-4 items-center">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="חיפוש לפי שם, טלפון או אימייל..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input pr-10"
            />
          </div>
          <ViewSelector
            entity="customers"
            onApplyView={() => {}}
          />
        </div>

        {/* Content */}
        {isLoading ? (
          <SkeletonCardGrid count={6} />
        ) : customers && customers.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {customers.map((customer) => (
              <CustomerCard key={customer.id} customer={customer} onDelete={handleDeleteCustomer} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Users size={40} />}
            title="אין לקוחות"
            description="עדיין לא נוספו לקוחות למערכת. התחל להוסיף לקוחות כדי לנהל אותם!"
            action={
              <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                <Plus size={18} />
                הוסף לקוח ראשון
              </button>
            }
          />
        )}
      </div>

      {/* Add Customer Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="לקוח חדש"
      >
        <CustomerForm
          onSubmit={handleAddCustomer}
          onCancel={() => setShowAddModal(false)}
          isLoading={createCustomer.isPending}
        />
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
            {/* Avatar */}
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-lg font-bold text-white">
                {customer.name.charAt(0)}
              </span>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-lg group-hover:text-blue-600 transition-colors">
                {customer.name}
              </h3>
              {customer.city && (
                <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                  <MapPin size={13} className="text-gray-400" />
                  {customer.city}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full text-sm font-medium">
            <Users size={14} />
            <span>{customer._count?.students || 0}</span>
          </div>
        </div>

        <div className="space-y-2.5 text-sm">
          <p className="flex items-center gap-2.5 text-gray-600">
            <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">
              <Phone size={14} className="text-gray-500" />
            </div>
            <span dir="ltr" className="text-gray-700">{customer.phone}</span>
          </p>
          <p className="flex items-center gap-2.5 text-gray-600">
            <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">
              <Mail size={14} className="text-gray-500" />
            </div>
            <span dir="ltr" className="truncate text-gray-700">{customer.email}</span>
          </p>
        </div>
      </Link>
      
      {/* Delete button - appears on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(customer.id);
        }}
        className="absolute top-3 left-3 p-2 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
        title="מחק לקוח"
      >
        <Trash2 size={16} />
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="form-label">שם *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="form-input"
            required
          />
        </div>

        <div>
          <label className="form-label">טלפון *</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className="form-input"
            dir="ltr"
            required
          />
        </div>

        <div>
          <label className="form-label">אימייל *</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="form-input"
            dir="ltr"
            required
          />
        </div>

        <div>
          <label className="form-label">כתובת</label>
          <input
            type="text"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            className="form-input"
          />
        </div>

        <div>
          <label className="form-label">עיר</label>
          <input
            type="text"
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            className="form-input"
          />
        </div>

        <div className="col-span-2">
          <label className="form-label">הערות</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="form-input"
            rows={3}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button type="submit" className="btn btn-primary" disabled={isLoading}>
          {isLoading ? 'שומר...' : 'שמור'}
        </button>
      </div>
    </form>
  );
}
