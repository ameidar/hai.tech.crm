import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Plus, BookOpen, RefreshCcw, Search, LayoutGrid, List, ChevronUp, ChevronDown, ChevronsUpDown, Edit } from 'lucide-react';
import { useCourses, useCreateCourse, useUpdateCourse } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { categoryHebrew } from '../types';
import ViewSelector from '../components/ViewSelector';
import type { Course, CourseCategory } from '../types';

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

const categoryColors: Record<CourseCategory, string> = {
  programming: 'bg-blue-100 text-blue-700',
  ai: 'bg-purple-100 text-purple-700',
  robotics: 'bg-orange-100 text-orange-700',
  printing_3d: 'bg-green-100 text-green-700',
};

export default function Courses() {
  const [searchParams] = useSearchParams();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('courses-view') as 'grid' | 'list') || 'grid'
  );
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  const toggleViewMode = (mode: 'grid' | 'list') => { setViewMode(mode); localStorage.setItem('courses-view', mode); };
  const handleSort = (key: string) => {
    setSortConfig(prev => prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  };

  const { data: courses, isLoading } = useCourses();

  useEffect(() => {
    const s = searchParams.get('search');
    if (s) setSearchFilter(s);
  }, [searchParams]);

  const displayList = (() => {
    let list = courses?.filter((course) => {
      if (!searchFilter) return true;
      const sl = searchFilter.toLowerCase();
      return course.name.toLowerCase().includes(sl) || course.description?.toLowerCase().includes(sl);
    }) ?? [];
    if (sortConfig) {
      list = [...list].sort((a, b) => {
        switch (sortConfig.key) {
          case 'name':
            return sortConfig.direction === 'asc'
              ? String(a.name ?? '').localeCompare(String(b.name ?? ''), 'he')
              : String(b.name ?? '').localeCompare(String(a.name ?? ''), 'he');
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

  const createCourse = useCreateCourse();
  const updateCourse = useUpdateCourse();

  const handleAddCourse = async (data: Partial<Course>) => {
    try { await createCourse.mutateAsync(data); setShowAddModal(false); }
    catch (error) { console.error('Failed to create course:', error); }
  };

  const handleUpdateCourse = async (data: Partial<Course>) => {
    if (!editingCourse) return;
    try { await updateCourse.mutateAsync({ id: editingCourse.id, data }); setEditingCourse(null); }
    catch (error) { console.error('Failed to update course:', error); }
  };

  return (
    <>
      <PageHeader
        title="קורסים"
        subtitle={`${displayList.length} קורסים`}
        actions={
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus size={18} /> קורס חדש
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        <div className="mb-6 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder="חיפוש קורס..." className="form-input pr-10 w-full" />
          </div>
          <span className="text-sm text-gray-500 mr-auto">{displayList.length} קורסים</span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => toggleViewMode('grid')} className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="כרטיסיות"><LayoutGrid size={16} /></button>
            <button onClick={() => toggleViewMode('list')} className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="שורות"><List size={16} /></button>
          </div>
          <ViewSelector entity="courses" onApplyView={() => {}} />
        </div>

        {isLoading ? (
          <Loading size="lg" text="טוען קורסים..." />
        ) : displayList.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayList.map((course) => (
                <CourseCard key={course.id} course={course} onEdit={() => setEditingCourse(course)} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <SortableTh label="שם" sortKey="name" sortConfig={sortConfig} onSort={handleSort} />
                    <th className="p-3 text-right font-medium text-gray-600">קטגוריה</th>
                    <th className="p-3 text-right font-medium text-gray-600">קהל יעד</th>
                    <SortableTh label="מחזורים" sortKey="cycles" sortConfig={sortConfig} onSort={handleSort} align="center" />
                    <th className="p-3 text-center font-medium text-gray-600">סטטוס</th>
                    <th className="p-3 text-right font-medium text-gray-600">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {displayList.map((course) => (
                    <tr key={course.id} className="hover:bg-gray-50 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center text-white shrink-0">
                            <BookOpen size={14} />
                          </div>
                          <span className="font-medium text-gray-900">{course.name}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${categoryColors[course.category]}`}>
                          {categoryHebrew[course.category]}
                        </span>
                      </td>
                      <td className="p-3 text-gray-600 text-sm">{course.targetAudience || '-'}</td>
                      <td className="p-3 text-center">
                        <Link to={`/cycles?courseId=${course.id}`} className="text-blue-600 hover:underline font-medium">
                          {course._count?.cycles || 0}
                        </Link>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`badge ${course.isActive ? 'badge-success' : 'badge-gray'}`}>{course.isActive ? 'פעיל' : 'לא פעיל'}</span>
                      </td>
                      <td className="p-3">
                        <button onClick={() => setEditingCourse(course)} className="text-blue-600 hover:text-blue-800 transition-colors" title="עריכה"><Edit size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <EmptyState
            icon={<BookOpen size={64} />}
            title="אין קורסים"
            description="עדיין לא נוספו קורסים למערכת"
            action={<button onClick={() => setShowAddModal(true)} className="btn btn-primary"><Plus size={18} /> הוסף קורס ראשון</button>}
          />
        )}
      </div>

      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="קורס חדש">
        <CourseForm onSubmit={handleAddCourse} onCancel={() => setShowAddModal(false)} isLoading={createCourse.isPending} />
      </Modal>
      <Modal isOpen={!!editingCourse} onClose={() => setEditingCourse(null)} title="עריכת קורס">
        {editingCourse && <CourseForm course={editingCourse} onSubmit={handleUpdateCourse} onCancel={() => setEditingCourse(null)} isLoading={updateCourse.isPending} />}
      </Modal>
    </>
  );
}

// Course Card
function CourseCard({ course, onEdit }: { course: Course; onEdit: () => void }) {
  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">{course.name}</h3>
            <span className={`inline-block mt-2 px-2 py-1 rounded-full text-xs font-medium ${categoryColors[course.category]}`}>
              {categoryHebrew[course.category]}
            </span>
          </div>
          <span className={`badge ${course.isActive ? 'badge-success' : 'badge-gray'}`}>{course.isActive ? 'פעיל' : 'לא פעיל'}</span>
        </div>
        {course.description && <p className="text-gray-600 text-sm mb-4 line-clamp-2">{course.description}</p>}
        {course.targetAudience && <p className="text-sm text-gray-500 mb-4"><span className="font-medium">קהל יעד:</span> {course.targetAudience}</p>}
        <div className="flex items-center justify-between pt-4 border-t">
          <Link to={`/cycles?courseId=${course.id}`} className="flex items-center gap-1 text-gray-500 hover:text-blue-600 text-sm transition-colors group">
            <RefreshCcw size={14} className="group-hover:text-blue-600" />
            <span className="group-hover:underline">{course._count?.cycles || 0} מחזורים</span>
          </Link>
          <button onClick={onEdit} className="text-blue-600 hover:underline text-sm">עריכה</button>
        </div>
      </div>
    </div>
  );
}

// Course Form
interface CourseFormProps {
  course?: Course;
  onSubmit: (data: Partial<Course>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function CourseForm({ course, onSubmit, onCancel, isLoading }: CourseFormProps) {
  const [formData, setFormData] = useState({
    name: course?.name || '',
    description: course?.description || '',
    targetAudience: course?.targetAudience || '',
    category: course?.category || 'programming',
    isActive: course?.isActive ?? true,
  });

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSubmit(formData); };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div>
        <label className="form-label">שם הקורס *</label>
        <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="form-input" required />
      </div>
      <div>
        <label className="form-label">תיאור</label>
        <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="form-input" rows={3} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">קטגוריה *</label>
          <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value as CourseCategory })} className="form-input">
            <option value="programming">תכנות</option>
            <option value="ai">בינה מלאכותית</option>
            <option value="robotics">רובוטיקה</option>
            <option value="printing_3d">הדפסה תלת-מימדית</option>
          </select>
        </div>
        <div>
          <label className="form-label">קהל יעד</label>
          <input type="text" value={formData.targetAudience} onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })} className="form-input" placeholder="לדוגמה: כיתות ג-ד" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="isActive" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        <label htmlFor="isActive" className="text-sm text-gray-700">קורס פעיל</label>
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">ביטול</button>
        <button type="submit" className="btn btn-primary" disabled={isLoading}>{isLoading ? 'שומר...' : 'שמור'}</button>
      </div>
    </form>
  );
}
