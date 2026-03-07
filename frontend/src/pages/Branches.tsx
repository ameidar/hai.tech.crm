import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Plus, Building2, MapPin, Phone, Mail, RefreshCcw, FileText, Search, Edit2, LayoutGrid, List, ChevronUp, ChevronDown, ChevronsUpDown, Trash2, CheckSquare, Square, X, Download } from 'lucide-react';
import { useBranches, useCreateBranch, useUpdateBranch, useDeleteBranch } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCardGrid } from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal';
import { branchTypeHebrew } from '../types';
import ViewSelector from '../components/ViewSelector';
import type { Branch, BranchType } from '../types';

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

const typeColors: Record<BranchType, string> = {
  school: 'bg-blue-50 text-blue-700 border-blue-200',
  community_center: 'bg-green-50 text-green-700 border-green-200',
  frontal: 'bg-purple-50 text-purple-700 border-purple-200',
  online: 'bg-orange-50 text-orange-700 border-orange-200',
};

const typeGradients: Record<BranchType, string> = {
  school: 'from-blue-500 to-blue-600',
  community_center: 'from-green-500 to-green-600',
  frontal: 'from-purple-500 to-purple-600',
  online: 'from-orange-500 to-orange-600',
};

export default function Branches() {
  const [searchParams] = useSearchParams();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Branch | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('branches-view') as 'grid' | 'list') || 'grid'
  );
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  const toggleViewMode = (mode: 'grid' | 'list') => { setViewMode(mode); localStorage.setItem('branches-view', mode); };
  const handleSort = (key: string) => {
    setSortConfig(prev => prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  };

  const { data: branches, isLoading } = useBranches();

  useEffect(() => {
    const s = searchParams.get('search');
    if (s) setSearchFilter(s);
  }, [searchParams]);

  const displayList = (() => {
    let list = branches?.filter((branch) => {
      if (!searchFilter) return true;
      const sl = searchFilter.toLowerCase();
      return branch.name.toLowerCase().includes(sl) || branch.city?.toLowerCase().includes(sl) || branch.address?.toLowerCase().includes(sl);
    }) ?? [];
    if (sortConfig) {
      list = [...list].sort((a, b) => {
        switch (sortConfig.key) {
          case 'name':
            return sortConfig.direction === 'asc'
              ? String(a.name ?? '').localeCompare(String(b.name ?? ''), 'he')
              : String(b.name ?? '').localeCompare(String(a.name ?? ''), 'he');
          case 'city':
            return sortConfig.direction === 'asc'
              ? String(a.city ?? '').localeCompare(String(b.city ?? ''), 'he')
              : String(b.city ?? '').localeCompare(String(a.city ?? ''), 'he');
          case 'cycles': {
            const av = a._count?.cycles ?? 0, bv = b._count?.cycles ?? 0;
            return sortConfig.direction === 'asc' ? av - bv : bv - av;
          }
          default: return 0;
        }
      });
    }
    return list;
  })();

  const createBranch = useCreateBranch();
  const updateBranch = useUpdateBranch();
  const deleteBranch = useDeleteBranch();

  const handleAddBranch = async (data: Partial<Branch>) => {
    try { await createBranch.mutateAsync(data); setShowAddModal(false); }
    catch (error) { console.error('Failed to create branch:', error); }
  };

  const handleEditBranch = async (data: Partial<Branch>) => {
    if (!editingBranch) return;
    try { await updateBranch.mutateAsync({ id: editingBranch.id, data }); setEditingBranch(null); }
    catch (error) { console.error('Failed to update branch:', error); }
  };

  const handleDeleteBranch = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteBranch.mutateAsync(deleteConfirm.id);
      setDeleteConfirm(null);
      setSelectedIds(prev => { const s = new Set(prev); s.delete(deleteConfirm.id); return s; });
    } catch (error: any) {
      alert(error?.response?.data?.message || 'שגיאה במחיקת הסניף');
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === displayList.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(displayList.map(b => b.id)));
  };
  const toggleSelect = (id: string) => {
    const s = new Set(selectedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedIds(s);
  };

  const handleBulkExport = () => {
    const selected = displayList.filter(b => selectedIds.has(b.id));
    const csv = ['שם,סוג,עיר,כתובת,מחזורים,פעיל', ...selected.map(b => `"${b.name}","${branchTypeHebrew[b.type]}","${b.city || ''}","${b.address || ''}","${b._count?.cycles || 0}","${b.isActive ? 'כן' : 'לא'}"`)].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'branches.csv'; link.click();
  };

  const allSelected = displayList.length > 0 && selectedIds.size === displayList.length;

  return (
    <>
      <PageHeader
        title="סניפים"
        subtitle={`${displayList.length} סניפים`}
        actions={
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus size={18} /> סניף חדש
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Bulk Actions Bar */}
        {selectedIds.size > 0 && (
          <div className="mb-4 p-4 bg-blue-600 text-white rounded-lg flex items-center gap-4 flex-wrap">
            <span className="font-semibold bg-white/20 px-3 py-1 rounded-full">{selectedIds.size} נבחרו</span>
            <button onClick={handleBulkExport} className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors flex items-center gap-1">
              <Download size={16} /> ייצא
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors flex items-center gap-1 ms-auto">
              <X size={16} /> ביטול
            </button>
          </div>
        )}
        <div className="mb-6 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder="חיפוש סניף..." className="form-input pr-10 w-full" />
          </div>
          <span className="text-sm text-gray-500 mr-auto">{displayList.length} סניפים</span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => toggleViewMode('grid')} className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="כרטיסיות"><LayoutGrid size={16} /></button>
            <button onClick={() => toggleViewMode('list')} className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="שורות"><List size={16} /></button>
          </div>
          <ViewSelector entity="branches" onApplyView={() => {}} />
        </div>

        {isLoading ? (
          <SkeletonCardGrid count={6} />
        ) : displayList.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayList.map((branch) => (
                <BranchCard
                  key={branch.id}
                  branch={branch}
                  onEdit={() => setEditingBranch(branch)}
                  onDelete={() => setDeleteConfirm(branch)}
                  isSelected={selectedIds.has(branch.id)}
                  onToggleSelect={() => toggleSelect(branch.id)}
                />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="p-3 w-10">
                      <button onClick={toggleSelectAll} className="p-1 hover:bg-gray-200 rounded transition-colors">
                        {allSelected ? <CheckSquare size={18} className="text-blue-600" /> : <Square size={18} className="text-gray-400" />}
                      </button>
                    </th>
                    <SortableTh label="שם" sortKey="name" sortConfig={sortConfig} onSort={handleSort} />
                    <th className="p-3 text-right font-medium text-gray-600">סוג</th>
                    <SortableTh label="עיר" sortKey="city" sortConfig={sortConfig} onSort={handleSort} />
                    <th className="p-3 text-right font-medium text-gray-600">כתובת</th>
                    <SortableTh label="מחזורים" sortKey="cycles" sortConfig={sortConfig} onSort={handleSort} align="center" />
                    <th className="p-3 text-center font-medium text-gray-600">הזמנות</th>
                    <th className="p-3 text-center font-medium text-gray-600">סטטוס</th>
                    <th className="p-3 text-right font-medium text-gray-600">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {displayList.map((branch) => (
                    <tr key={branch.id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(branch.id) ? 'bg-blue-50' : ''}`}>
                      <td className="p-3">
                        <button onClick={() => toggleSelect(branch.id)} className="p-1 hover:bg-gray-200 rounded transition-colors">
                          {selectedIds.has(branch.id) ? <CheckSquare size={18} className="text-blue-600" /> : <Square size={18} className="text-gray-400" />}
                        </button>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 bg-gradient-to-br ${typeGradients[branch.type]} rounded-lg flex items-center justify-center text-white shrink-0`}>
                            <Building2 size={14} />
                          </div>
                          <span className="font-medium text-gray-900">{branch.name}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${typeColors[branch.type]}`}>
                          {branchTypeHebrew[branch.type]}
                        </span>
                      </td>
                      <td className="p-3 text-gray-600">{branch.city || '-'}</td>
                      <td className="p-3 text-gray-600 max-w-[160px] truncate">{branch.address || '-'}</td>
                      <td className="p-3 text-center">
                        <Link to={`/cycles?branchId=${branch.id}`} className="text-blue-600 hover:underline font-medium">
                          {branch._count?.cycles ?? 0}
                        </Link>
                      </td>
                      <td className="p-3 text-center text-gray-600">{branch._count?.institutionalOrders ?? 0}</td>
                      <td className="p-3 text-center">
                        <span className={`badge ${branch.isActive ? 'badge-success' : 'badge-gray'}`}>{branch.isActive ? 'פעיל' : 'לא פעיל'}</span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditingBranch(branch)} className="p-1.5 hover:bg-blue-100 rounded transition-colors text-blue-600" title="עריכה"><Edit2 size={14} /></button>
                          <button onClick={() => setDeleteConfirm(branch)} className="p-1.5 hover:bg-red-100 rounded transition-colors text-red-500" title="מחיקה"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <EmptyState
            icon={<Building2 size={40} />}
            title="אין סניפים"
            description="עדיין לא נוספו סניפים למערכת. הוסף סניפים כדי לארגן את הפעילויות!"
            action={<button onClick={() => setShowAddModal(true)} className="btn btn-primary"><Plus size={18} /> הוסף סניף ראשון</button>}
          />
        )}
      </div>

      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="סניף חדש" size="lg">
        <BranchForm onSubmit={handleAddBranch} onCancel={() => setShowAddModal(false)} isLoading={createBranch.isPending} />
      </Modal>
      <Modal isOpen={!!editingBranch} onClose={() => setEditingBranch(null)} title="עריכת סניף" size="lg">
        {editingBranch && <BranchForm branch={editingBranch} onSubmit={handleEditBranch} onCancel={() => setEditingBranch(null)} isLoading={updateBranch.isPending} />}
      </Modal>
      <ConfirmDeleteModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDeleteBranch}
        title="מחיקת סניף"
        itemName={deleteConfirm?.name}
        warningText={(deleteConfirm?._count?.cycles || 0) > 0 ? `לסניף זה יש ${deleteConfirm?._count?.cycles} מחזורים פעילים. לא ניתן למחוק.` : undefined}
        isLoading={deleteBranch.isPending}
      />
    </>
  );
}

// Branch Card
function BranchCard({ branch, onEdit, onDelete, isSelected, onToggleSelect }: {
  branch: Branch;
  onEdit: () => void;
  onDelete: () => void;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  return (
    <div className="group bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all duration-200 hover:-translate-y-0.5">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 bg-gradient-to-br ${typeGradients[branch.type]} rounded-xl flex items-center justify-center shadow-sm`}>
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
            <button onClick={onToggleSelect} className="p-1 hover:bg-gray-100 rounded transition-colors" title="בחר">
              {isSelected ? <CheckSquare size={18} className="text-blue-600" /> : <Square size={18} className="text-gray-300 hover:text-gray-500" />}
            </button>
            <button onClick={onEdit} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200" title="ערוך סניף"><Edit2 size={16} /></button>
            <button onClick={onDelete} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200" title="מחק סניף"><Trash2 size={16} /></button>
            <span className={`badge ${branch.isActive ? 'badge-success' : 'badge-gray'}`}>{branch.isActive ? 'פעיל' : 'לא פעיל'}</span>
          </div>
        </div>
        <div className="space-y-2.5 text-sm mb-4">
          {(branch.address || branch.city) && (
            <p className="flex items-center gap-2.5 text-gray-600">
              <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center"><MapPin size={14} className="text-gray-500" /></div>
              <span className="text-gray-700">{branch.address}{branch.address && branch.city && ', '}{branch.city}</span>
            </p>
          )}
          {branch.contactPhone && (
            <p className="flex items-center gap-2.5 text-gray-600">
              <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center"><Phone size={14} className="text-gray-500" /></div>
              <span dir="ltr" className="text-gray-700">{branch.contactPhone}</span>
            </p>
          )}
          {branch.contactEmail && (
            <p className="flex items-center gap-2.5 text-gray-600">
              <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center"><Mail size={14} className="text-gray-500" /></div>
              <span dir="ltr" className="truncate text-gray-700">{branch.contactEmail}</span>
            </p>
          )}
        </div>
        <div className="flex items-center justify-between pt-4 border-t border-gray-100 text-sm">
          <div className="flex items-center gap-4 text-gray-500">
            <Link to={`/cycles?branchId=${branch.id}`} className="flex items-center gap-1.5 hover:text-blue-600 transition-colors font-medium">
              <RefreshCcw size={14} />{branch._count?.cycles || 0} מחזורים
            </Link>
            <span className="flex items-center gap-1.5"><FileText size={14} />{branch._count?.institutionalOrders || 0} הזמנות</span>
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

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSubmit(formData); };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="form-label">שם הסניף *</label>
          <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="form-input" required />
        </div>
        <div>
          <label className="form-label">סוג *</label>
          <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as BranchType })} className="form-input">
            <option value="school">בית ספר</option>
            <option value="community_center">מתנ"ס</option>
            <option value="frontal">פרונטלי</option>
            <option value="online">אונליין</option>
          </select>
        </div>
        <div>
          <label className="form-label">עיר</label>
          <input type="text" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className="form-input" />
        </div>
        <div className="col-span-2">
          <label className="form-label">כתובת</label>
          <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="form-input" />
        </div>
      </div>
      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-700 mb-4">איש קשר</h4>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="form-label">שם</label>
            <input type="text" value={formData.contactName} onChange={(e) => setFormData({ ...formData, contactName: e.target.value })} className="form-input" />
          </div>
          <div>
            <label className="form-label">טלפון</label>
            <input type="tel" value={formData.contactPhone} onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })} className="form-input" dir="ltr" />
          </div>
          <div>
            <label className="form-label">אימייל</label>
            <input type="email" value={formData.contactEmail} onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })} className="form-input" dir="ltr" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="isActive" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        <label htmlFor="isActive" className="text-sm text-gray-700">סניף פעיל</label>
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">ביטול</button>
        <button type="submit" className="btn btn-primary" disabled={isLoading}>{isLoading ? 'שומר...' : 'שמור'}</button>
      </div>
    </form>
  );
}
