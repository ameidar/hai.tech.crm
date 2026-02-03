import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Plus, Building2, MapPin, Phone, Mail, RefreshCcw, FileText, Search, Edit2 } from 'lucide-react';
import { useBranches, useCreateBranch, useUpdateBranch } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCardGrid } from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { branchTypeHebrew } from '../types';
import ViewSelector from '../components/ViewSelector';
import type { Branch, BranchType } from '../types';

export default function Branches() {
  const [searchParams] = useSearchParams();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  const { data: branches, isLoading } = useBranches();

  // Initialize search from URL params
  useEffect(() => {
    const search = searchParams.get('search');
    if (search) {
      setSearchFilter(search);
    }
  }, [searchParams]);

  // Filter branches
  const filteredBranches = branches?.filter((branch) => {
    if (!searchFilter) return true;
    const searchLower = searchFilter.toLowerCase();
    return (
      branch.name.toLowerCase().includes(searchLower) ||
      branch.city?.toLowerCase().includes(searchLower) ||
      branch.address?.toLowerCase().includes(searchLower)
    );
  });
  const createBranch = useCreateBranch();
  const updateBranch = useUpdateBranch();

  const handleAddBranch = async (data: Partial<Branch>) => {
    try {
      await createBranch.mutateAsync(data);
      setShowAddModal(false);
    } catch (error) {
      console.error('Failed to create branch:', error);
    }
  };

  const handleEditBranch = async (data: Partial<Branch>) => {
    if (!editingBranch) return;
    try {
      await updateBranch.mutateAsync({ id: editingBranch.id, data });
      setEditingBranch(null);
    } catch (error) {
      console.error('Failed to update branch:', error);
    }
  };

  return (
    <>
      <PageHeader
        title="סניפים"
        subtitle={`${branches?.length || 0} סניפים`}
        actions={
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus size={18} />
            סניף חדש
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Search & Views */}
        <div className="mb-4 flex gap-4 items-center">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="חיפוש סניף..."
              className="form-input pr-10 w-full"
            />
          </div>
          <ViewSelector entity="branches" onApplyView={() => {}} />
        </div>

        {isLoading ? (
          <SkeletonCardGrid count={6} />
        ) : filteredBranches && filteredBranches.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBranches.map((branch) => (
              <BranchCard key={branch.id} branch={branch} onEdit={() => setEditingBranch(branch)} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Building2 size={40} />}
            title="אין סניפים"
            description="עדיין לא נוספו סניפים למערכת. הוסף סניפים כדי לארגן את הפעילויות!"
            action={
              <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                <Plus size={18} />
                הוסף סניף ראשון
              </button>
            }
          />
        )}
      </div>

      {/* Add Branch Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="סניף חדש"
        size="lg"
      >
        <BranchForm
          onSubmit={handleAddBranch}
          onCancel={() => setShowAddModal(false)}
          isLoading={createBranch.isPending}
        />
      </Modal>

      {/* Edit Branch Modal */}
      <Modal
        isOpen={!!editingBranch}
        onClose={() => setEditingBranch(null)}
        title="עריכת סניף"
        size="lg"
      >
        {editingBranch && (
          <BranchForm
            branch={editingBranch}
            onSubmit={handleEditBranch}
            onCancel={() => setEditingBranch(null)}
            isLoading={updateBranch.isPending}
          />
        )}
      </Modal>
    </>
  );
}

// Branch Card
function BranchCard({ branch, onEdit }: { branch: Branch; onEdit: () => void }) {
  const typeColors: Record<BranchType, string> = {
    school: 'bg-blue-50 text-blue-700 border-blue-200',
    community_center: 'bg-green-50 text-green-700 border-green-200',
    frontal: 'bg-purple-50 text-purple-700 border-purple-200',
    online: 'bg-orange-50 text-orange-700 border-orange-200',
  };

  const typeIcons: Record<BranchType, string> = {
    school: 'from-blue-500 to-blue-600',
    community_center: 'from-green-500 to-green-600',
    frontal: 'from-purple-500 to-purple-600',
    online: 'from-orange-500 to-orange-600',
  };

  return (
    <div className="group bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all duration-200 hover:-translate-y-0.5">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 bg-gradient-to-br ${typeIcons[branch.type]} rounded-xl flex items-center justify-center shadow-sm`}>
              <Building2 size={20} className="text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-lg group-hover:text-blue-600 transition-colors">{branch.name}</h3>
              <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${typeColors[branch.type]}`}>
                {branchTypeHebrew[branch.type]}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200"
              title="ערוך סניף"
            >
              <Edit2 size={16} />
            </button>
            <span className={`badge ${branch.isActive ? 'badge-success' : 'badge-gray'}`}>
              {branch.isActive ? 'פעיל' : 'לא פעיל'}
            </span>
          </div>
        </div>

        <div className="space-y-2.5 text-sm mb-4">
          {(branch.address || branch.city) && (
            <p className="flex items-center gap-2.5 text-gray-600">
              <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">
                <MapPin size={14} className="text-gray-500" />
              </div>
              <span className="text-gray-700">
                {branch.address}
                {branch.address && branch.city && ', '}
                {branch.city}
              </span>
            </p>
          )}
          {branch.contactPhone && (
            <p className="flex items-center gap-2.5 text-gray-600">
              <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">
                <Phone size={14} className="text-gray-500" />
              </div>
              <span dir="ltr" className="text-gray-700">{branch.contactPhone}</span>
            </p>
          )}
          {branch.contactEmail && (
            <p className="flex items-center gap-2.5 text-gray-600">
              <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">
                <Mail size={14} className="text-gray-500" />
              </div>
              <span dir="ltr" className="truncate text-gray-700">{branch.contactEmail}</span>
            </p>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-gray-100 text-sm">
          <div className="flex items-center gap-4 text-gray-500">
            <Link 
              to={`/cycles?branchId=${branch.id}`}
              className="flex items-center gap-1.5 hover:text-blue-600 transition-colors font-medium"
            >
              <RefreshCcw size={14} />
              {branch._count?.cycles || 0} מחזורים
            </Link>
            <span className="flex items-center gap-1.5">
              <FileText size={14} />
              {branch._count?.institutionalOrders || 0} הזמנות
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Branch Form
interface BranchFormProps {
  branch?: Branch;
  onSubmit: (data: Partial<Branch>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function BranchForm({ branch, onSubmit, onCancel, isLoading }: BranchFormProps) {
  const [formData, setFormData] = useState({
    name: branch?.name || '',
    type: branch?.type || 'school',
    address: branch?.address || '',
    city: branch?.city || '',
    contactName: branch?.contactName || '',
    contactPhone: branch?.contactPhone || '',
    contactEmail: branch?.contactEmail || '',
    isActive: branch?.isActive ?? true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="form-label">שם הסניף *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="form-input"
            required
          />
        </div>

        <div>
          <label className="form-label">סוג *</label>
          <select
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value as BranchType })}
            className="form-input"
          >
            <option value="school">בית ספר</option>
            <option value="community_center">מתנ"ס</option>
            <option value="frontal">פרונטלי</option>
            <option value="online">אונליין</option>
          </select>
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
          <label className="form-label">כתובת</label>
          <input
            type="text"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            className="form-input"
          />
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-700 mb-4">איש קשר</h4>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="form-label">שם</label>
            <input
              type="text"
              value={formData.contactName}
              onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
              className="form-input"
            />
          </div>

          <div>
            <label className="form-label">טלפון</label>
            <input
              type="tel"
              value={formData.contactPhone}
              onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
              className="form-input"
              dir="ltr"
            />
          </div>

          <div>
            <label className="form-label">אימייל</label>
            <input
              type="email"
              value={formData.contactEmail}
              onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
              className="form-input"
              dir="ltr"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isActive"
          checked={formData.isActive}
          onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="isActive" className="text-sm text-gray-700">
          סניף פעיל
        </label>
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
