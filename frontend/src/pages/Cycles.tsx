import { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCcw, Calendar, Users, Clock, Edit, Trash2, Search, X, Check, CheckSquare, Square } from 'lucide-react';
import { useCycles, useCourses, useBranches, useInstructors, useCreateCycle, useUpdateCycle, useDeleteCycle, useBulkUpdateCycles, useBulkGenerateMeetings, useViewData } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading, { SkeletonTable } from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ViewSelector from '../components/ViewSelector';
import { cycleStatusHebrew, cycleTypeHebrew, dayOfWeekHebrew } from '../types';
import type { Cycle, CycleType, CycleStatus, DayOfWeek, ActivityType } from '../types';
import { activityTypeHebrew } from '../types';

export default function Cycles() {
  const [searchParams] = useSearchParams();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCycle, setEditingCycle] = useState<Cycle | null>(null);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [selectedCycles, setSelectedCycles] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<CycleStatus | ''>('');
  const [instructorFilter, setInstructorFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [dayFilter, setDayFilter] = useState<DayOfWeek | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'filters' | 'view'>('filters');
  const [pageSize, setPageSize] = useState<number>(100);

  // Initialize filters from URL params
  useEffect(() => {
    const branchId = searchParams.get('branchId');
    const instructorId = searchParams.get('instructorId');
    const courseId = searchParams.get('courseId');
    if (branchId) setBranchFilter(branchId);
    if (instructorId) setInstructorFilter(instructorId);
    if (courseId) setCourseFilter(courseId);
  }, [searchParams]);

  // Debounce search
  useMemo(() => {
    const timeout = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const { data: cycles, isLoading } = useCycles({ 
    status: statusFilter || undefined,
    instructorId: instructorFilter || undefined,
    branchId: branchFilter || undefined,
    courseId: courseFilter || undefined,
    dayOfWeek: dayFilter || undefined,
    search: debouncedSearch || undefined,
    limit: pageSize,
  });
  const { data: courses } = useCourses();
  const { data: branches } = useBranches();
  const { data: instructors } = useInstructors();
  const createCycle = useCreateCycle();
  const updateCycle = useUpdateCycle();
  const deleteCycle = useDeleteCycle();
  const bulkUpdateCycles = useBulkUpdateCycles();
  const bulkGenerateMeetings = useBulkGenerateMeetings();
  const { data: viewData, isLoading: viewLoading } = useViewData(activeViewId, []);

  // Determine which data to display based on view mode
  const displayCycles = viewMode === 'view' && viewData?.data 
    ? viewData.data as Cycle[]
    : cycles || [];
  const displayLoading = viewMode === 'view' ? viewLoading : isLoading;

  // Selection helpers
  const toggleCycle = (id: string) => {
    setSelectedCycles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleAll = () => {
    if (!displayCycles || displayCycles.length === 0) return;
    if (selectedCycles.size === displayCycles.length) {
      setSelectedCycles(new Set());
    } else {
      setSelectedCycles(new Set(displayCycles.map(c => c.id)));
    }
  };

  const handleBulkUpdate = async (data: Partial<Cycle>) => {
    try {
      await bulkUpdateCycles.mutateAsync({
        ids: Array.from(selectedCycles),
        data,
      });
      setSelectedCycles(new Set());
      setShowBulkEditModal(false);
    } catch (error) {
      console.error('Failed to bulk update cycles:', error);
      alert('שגיאה בעדכון המחזורים');
    }
  };

  const clearFilters = () => {
    setStatusFilter('');
    setInstructorFilter('');
    setBranchFilter('');
    setCourseFilter('');
    setDayFilter('');
    setSearchQuery('');
  };

  const hasActiveFilters = statusFilter || instructorFilter || branchFilter || courseFilter || dayFilter || searchQuery;

  const handleDeleteCycle = async (id: string, name: string) => {
    if (window.confirm(`האם למחוק את המחזור "${name}"? פעולה זו תמחק גם את כל הפגישות הקשורות.`)) {
      try {
        await deleteCycle.mutateAsync(id);
      } catch (error) {
        console.error('Failed to delete cycle:', error);
        alert('שגיאה במחיקת המחזור');
      }
    }
  };

  const handleAddCycle = async (data: Partial<Cycle>) => {
    try {
      await createCycle.mutateAsync(data);
      setShowAddModal(false);
    } catch (error) {
      console.error('Failed to create cycle:', error);
    }
  };

  const handleUpdateCycle = async (data: Partial<Cycle>) => {
    if (!editingCycle) return;
    try {
      await updateCycle.mutateAsync({ id: editingCycle.id, data });
      setEditingCycle(null);
    } catch (error) {
      console.error('Failed to update cycle:', error);
      alert('שגיאה בעדכון המחזור');
    }
  };

  const formatTime = (time: string) => {
    // Handle ISO date format (1970-01-01T16:00:00.000Z) or simple time (16:00)
    if (time.includes('T')) {
      // Extract UTC time directly without timezone conversion
      const date = new Date(time);
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    return time.substring(0, 5);
  };

  return (
    <>
      <PageHeader
        title="מחזורים"
        subtitle={`${displayCycles?.length || 0} מחזורים`}
        actions={
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary" data-testid="add-cycle-btn">
            <Plus size={18} />
            מחזור חדש
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Filters */}
        <div className="mb-6 space-y-4">
          <div className="flex flex-wrap gap-4 items-center">
            {/* Search by name */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="חיפוש לפי שם מחזור..."
                className="form-input pr-10 w-full"
                data-testid="search-input"
              />
            </div>

            {/* Instructor filter */}
            <div className="w-36">
              <select
                value={instructorFilter}
                onChange={(e) => setInstructorFilter(e.target.value)}
                className="form-input"
              >
                <option value="">כל המדריכים</option>
                {instructors?.map((instructor) => (
                  <option key={instructor.id} value={instructor.id}>
                    {instructor.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Branch filter */}
            <div className="w-36">
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="form-input"
              >
                <option value="">כל הסניפים</option>
                {branches?.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Course filter */}
            <div className="w-36">
              <select
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                className="form-input"
              >
                <option value="">כל הקורסים</option>
                {courses?.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Day filter */}
            <div className="w-28">
              <select
                value={dayFilter}
                onChange={(e) => setDayFilter(e.target.value as DayOfWeek | '')}
                className="form-input"
              >
                <option value="">כל הימים</option>
                <option value="sunday">ראשון</option>
                <option value="monday">שני</option>
                <option value="tuesday">שלישי</option>
                <option value="wednesday">רביעי</option>
                <option value="thursday">חמישי</option>
                <option value="friday">שישי</option>
              </select>
            </div>

            {/* Status filter */}
            <div className="w-32">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as CycleStatus | '')}
                className="form-input"
              >
                <option value="">כל הסטטוסים</option>
                <option value="active">פעיל</option>
                <option value="completed">הושלם</option>
                <option value="cancelled">בוטל</option>
              </select>
            </div>

            {/* Page size selector */}
            <div className="w-28">
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="form-input"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>הכל</option>
              </select>
            </div>

            {/* View Selector */}
            <ViewSelector
              entity="cycles"
              onApplyView={() => {}}
              onViewSelect={(viewId) => {
                setActiveViewId(viewId);
                if (viewId) {
                  setViewMode('view');
                } else {
                  setViewMode('filters');
                }
              }}
            />

            {/* Clear filters button */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="btn btn-secondary flex items-center gap-1"
              >
                <X size={16} />
                נקה סינון
              </button>
            )}
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {selectedCycles.size > 0 && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckSquare size={20} className="text-blue-600" />
              <span className="font-medium text-blue-900">
                {selectedCycles.size} מחזורים נבחרו
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowBulkEditModal(true)}
                className="btn btn-primary flex items-center gap-2"
              >
                <Edit size={16} />
                עריכה גורפת
              </button>
              <button
                onClick={async () => {
                  if (confirm(`האם ליצור פגישות ל-${selectedCycles.size} מחזורים?`)) {
                    try {
                      const result = await bulkGenerateMeetings.mutateAsync(Array.from(selectedCycles));
                      alert(result.message);
                      setSelectedCycles(new Set());
                    } catch (error: any) {
                      alert(error.message || 'שגיאה ביצירת פגישות');
                    }
                  }
                }}
                disabled={bulkGenerateMeetings.isPending}
                className="btn btn-success flex items-center gap-2"
              >
                <Calendar size={16} />
                {bulkGenerateMeetings.isPending ? 'יוצר...' : 'צור פגישות'}
              </button>
              <button
                onClick={() => setSelectedCycles(new Set())}
                className="btn btn-secondary"
              >
                בטל בחירה
              </button>
            </div>
          </div>
        )}

        {displayLoading ? (
          <SkeletonTable rows={8} columns={11} />
        ) : displayCycles && displayCycles.length > 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table data-testid="cycles-table">
                <thead>
                  <tr>
                    <th className="w-12">
                      <button
                        onClick={toggleAll}
                        className="p-1 hover:bg-gray-200 rounded transition-colors"
                        title={selectedCycles.size === displayCycles.length ? 'בטל הכל' : 'בחר הכל'}
                      >
                        {selectedCycles.size === displayCycles.length ? (
                          <CheckSquare size={18} className="text-blue-600" />
                        ) : selectedCycles.size > 0 ? (
                          <CheckSquare size={18} className="text-blue-400" />
                        ) : (
                          <Square size={18} className="text-gray-400" />
                        )}
                      </button>
                    </th>
                    <th>שם המחזור</th>
                    <th>קורס</th>
                    <th>סניף</th>
                    <th>מדריך</th>
                    <th>תאריך התחלה</th>
                    <th>יום ושעה</th>
                    <th>סוג</th>
                    <th>מחיר לתלמיד</th>
                    <th>הכנסה למפגש</th>
                    <th>התקדמות</th>
                    <th>סטטוס</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {displayCycles.map((cycle, index) => (
                    <tr 
                      key={cycle.id} 
                      className={`
                        ${selectedCycles.has(cycle.id) ? 'bg-blue-50 hover:bg-blue-100' : ''}
                        transition-colors duration-150
                      `}
                    >
                      <td>
                        <button
                          onClick={() => toggleCycle(cycle.id)}
                          className="p-1 hover:bg-gray-100 rounded transition-colors"
                        >
                          {selectedCycles.has(cycle.id) ? (
                            <CheckSquare size={18} className="text-blue-600" />
                          ) : (
                            <Square size={18} className="text-gray-400 hover:text-gray-600" />
                          )}
                        </button>
                      </td>
                      <td>
                        <Link
                          to={`/cycles/${cycle.id}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                        >
                          {cycle.name}
                        </Link>
                      </td>
                      <td>
                        {cycle.course ? (
                          <Link
                            to={`/courses?search=${encodeURIComponent(cycle.course.name)}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {cycle.course.name}
                          </Link>
                        ) : <span className="text-gray-400">-</span>}
                      </td>
                      <td>
                        {cycle.branch ? (
                          <Link
                            to={`/branches?search=${encodeURIComponent(cycle.branch.name)}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {cycle.branch.name}
                          </Link>
                        ) : <span className="text-gray-400">-</span>}
                      </td>
                      <td>
                        {cycle.instructor ? (
                          <Link
                            to={`/instructors?search=${encodeURIComponent(cycle.instructor.name)}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {cycle.instructor.name}
                          </Link>
                        ) : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="text-gray-600">
                        {new Date(cycle.startDate).toLocaleDateString('he-IL')}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 text-gray-700">
                          <Clock size={14} className="text-gray-400" />
                          <span>
                            {dayOfWeekHebrew[cycle.dayOfWeek]} {formatTime(cycle.startTime)}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${cycle.type === 'private' ? 'badge-warning' : 'badge-info'}`}>
                          {cycleTypeHebrew[cycle.type]}
                        </span>
                      </td>
                      <td className="text-gray-600">
                        {cycle.pricePerStudent ? `₪${Number(cycle.pricePerStudent).toLocaleString()}` : '-'}
                      </td>
                      <td className="text-gray-600">
                        {cycle.meetingRevenue ? `₪${Number(cycle.meetingRevenue).toLocaleString()}` : '-'}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300"
                              style={{
                                width: `${(cycle.completedMeetings / cycle.totalMeetings) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-sm text-gray-500 tabular-nums">
                            {cycle.completedMeetings}/{cycle.totalMeetings}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${
                          cycle.status === 'active' ? 'badge-success' :
                          cycle.status === 'completed' ? 'badge-info' : 'badge-danger'
                        }`}>
                          {cycleStatusHebrew[cycle.status]}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditingCycle(cycle)}
                            className="icon-btn icon-btn-primary"
                            title="עריכה"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteCycle(cycle.id, cycle.name)}
                            className="icon-btn icon-btn-danger"
                            title="מחיקה"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<RefreshCcw size={40} />}
            title="אין מחזורים"
            description="עדיין לא נוספו מחזורים למערכת. צור מחזור חדש כדי להתחיל!"
            action={
              <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                <Plus size={18} />
                הוסף מחזור ראשון
              </button>
            }
          />
        )}
      </div>

      {/* Add Cycle Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="מחזור חדש"
        size="xl"
      >
        <CycleForm
          courses={courses || []}
          branches={branches || []}
          instructors={instructors || []}
          onSubmit={handleAddCycle}
          onCancel={() => setShowAddModal(false)}
          isLoading={createCycle.isPending}
        />
      </Modal>

      {/* Edit Cycle Modal */}
      <Modal
        isOpen={!!editingCycle}
        onClose={() => setEditingCycle(null)}
        title="עריכת מחזור"
        size="xl"
      >
        {editingCycle && (
          <CycleEditForm
            cycle={editingCycle}
            courses={courses || []}
            branches={branches || []}
            instructors={instructors || []}
            onSubmit={handleUpdateCycle}
            onCancel={() => setEditingCycle(null)}
            isLoading={updateCycle.isPending}
          />
        )}
      </Modal>

      {/* Bulk Edit Modal */}
      <Modal
        isOpen={showBulkEditModal}
        onClose={() => setShowBulkEditModal(false)}
        title={`עריכה גורפת - ${selectedCycles.size} מחזורים`}
        size="lg"
      >
        <BulkEditForm
          selectedCount={selectedCycles.size}
          instructors={instructors || []}
          onSubmit={handleBulkUpdate}
          onCancel={() => setShowBulkEditModal(false)}
          isLoading={bulkUpdateCycles.isPending}
        />
      </Modal>
    </>
  );
}

// Cycle Form
interface CycleFormProps {
  courses: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  instructors: { id: string; name: string }[];
  onSubmit: (data: Partial<Cycle>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function CycleForm({ courses, branches, instructors, onSubmit, onCancel, isLoading }: CycleFormProps) {
  const [formData, setFormData] = useState({
    name: '',
    courseId: '',
    branchId: '',
    instructorId: '',
    type: 'private' as CycleType,
    startDate: '',
    endDate: '',
    dayOfWeek: 'sunday' as DayOfWeek,
    startTime: '16:00',
    endTime: '17:30',
    durationMinutes: 90,
    totalMeetings: 12,
    pricePerStudent: 0,
    meetingRevenue: 0,
    studentCount: 0,
    maxStudents: 15,
    sendParentReminders: true,
    isOnline: false,
    activityType: 'frontal' as ActivityType,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const priceValue = Number(formData.pricePerStudent);
    const meetingRevenueValue = Number(formData.meetingRevenue);
    const studentCountValue = Number(formData.studentCount);
    const maxStudentsValue = Number(formData.maxStudents);
    
    // Calculate duration from start/end times
    const [startHour, startMin] = formData.startTime.split(':').map(Number);
    const [endHour, endMin] = formData.endTime.split(':').map(Number);
    const calculatedDuration = (endHour * 60 + endMin) - (startHour * 60 + startMin);
    const durationMinutes = calculatedDuration > 0 ? calculatedDuration : Number(formData.durationMinutes);
    
    const submitData: any = {
      ...formData,
      durationMinutes,
      totalMeetings: Number(formData.totalMeetings),
      pricePerStudent: (formData.type === 'private' || formData.type === 'institutional_per_child') && priceValue > 0 ? priceValue : undefined,
      meetingRevenue: formData.type === 'institutional_fixed' && meetingRevenueValue > 0 ? meetingRevenueValue : undefined,
      studentCount: formData.type === 'institutional_per_child' && studentCountValue > 0 ? studentCountValue : undefined,
      maxStudents: maxStudentsValue > 0 ? maxStudentsValue : undefined,
    };
    // Remove endDate if empty - it will be calculated automatically
    if (!submitData.endDate) {
      delete submitData.endDate;
    }
    onSubmit(submitData);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="form-label">שם המחזור *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="form-input"
            placeholder="לדוגמה: מיינקראפט JS - אורט באר שבע - סמסטר א"
            required
          />
        </div>

        <div>
          <label className="form-label">קורס *</label>
          <select
            value={formData.courseId}
            onChange={(e) => setFormData({ ...formData, courseId: e.target.value })}
            className="form-input"
            required
          >
            <option value="">בחר קורס</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label">סניף *</label>
          <select
            value={formData.branchId}
            onChange={(e) => setFormData({ ...formData, branchId: e.target.value })}
            className="form-input"
            required
          >
            <option value="">בחר סניף</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label">מדריך *</label>
          <select
            value={formData.instructorId}
            onChange={(e) => setFormData({ ...formData, instructorId: e.target.value })}
            className="form-input"
            required
          >
            <option value="">בחר מדריך</option>
            {instructors.map((instructor) => (
              <option key={instructor.id} value={instructor.id}>
                {instructor.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label">סוג מחזור *</label>
          <select
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value as CycleType })}
            className="form-input"
          >
            <option value="private">פרטי</option>
            <option value="institutional_per_child">מוסדי (פר ילד)</option>
            <option value="institutional_fixed">מוסדי (סכום קבוע)</option>
          </select>
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-700 mb-4">תאריכים</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">תאריך התחלה *</label>
            <input
              type="date"
              value={formData.startDate}
              onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
              className="form-input"
              required
            />
          </div>

          <div>
            <label className="form-label">תאריך סיום</label>
            <input
              type="date"
              value={formData.endDate}
              onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
              className="form-input"
            />
            <p className="text-xs text-gray-500 mt-1">אופציונלי - יחושב אוטומטית לפי מספר המפגשים וחגים</p>
          </div>
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-700 mb-4">לוח זמנים</h4>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="form-label">יום בשבוע *</label>
            <select
              value={formData.dayOfWeek}
              onChange={(e) => setFormData({ ...formData, dayOfWeek: e.target.value as DayOfWeek })}
              className="form-input"
            >
              <option value="sunday">ראשון</option>
              <option value="monday">שני</option>
              <option value="tuesday">שלישי</option>
              <option value="wednesday">רביעי</option>
              <option value="thursday">חמישי</option>
              <option value="friday">שישי</option>
            </select>
          </div>

          <div>
            <label className="form-label">שעת התחלה *</label>
            <input
              type="time"
              value={formData.startTime}
              onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
              className="form-input"
              required
            />
          </div>

          <div>
            <label className="form-label">שעת סיום *</label>
            <input
              type="time"
              value={formData.endTime}
              onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
              className="form-input"
              required
            />
          </div>

          <div>
            <label className="form-label">סה"כ מפגשים *</label>
            <input
              type="number"
              value={formData.totalMeetings}
              onChange={(e) => setFormData({ ...formData, totalMeetings: Number(e.target.value) })}
              className="form-input"
              min="1"
              required
            />
          </div>
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-700 mb-4">הגדרות נוספות</h4>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="form-label">מקסימום תלמידים</label>
            <input
              type="number"
              value={formData.maxStudents}
              onChange={(e) => setFormData({ ...formData, maxStudents: Number(e.target.value) })}
              className="form-input"
              min="1"
            />
          </div>

          {(formData.type === 'private' || formData.type === 'institutional_per_child') && (
            <div>
              <label className="form-label">מחיר לתלמיד {formData.type === 'institutional_per_child' ? '(למפגש)' : ''}</label>
              <div className="relative">
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
                <input
                  type="number"
                  value={formData.pricePerStudent}
                  onChange={(e) => setFormData({ ...formData, pricePerStudent: Number(e.target.value) })}
                  className="form-input pr-8"
                  min="0"
                />
              </div>
            </div>
          )}

          {formData.type === 'institutional_per_child' && (
            <div>
              <label className="form-label">מספר נרשמים</label>
              <input
                type="number"
                value={formData.studentCount}
                onChange={(e) => setFormData({ ...formData, studentCount: Number(e.target.value) })}
                className="form-input"
                min="0"
              />
            </div>
          )}

          {formData.type === 'institutional_fixed' && (
            <div>
              <label className="form-label">הכנסה למפגש</label>
              <div className="relative">
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
                <input
                  type="number"
                  value={formData.meetingRevenue}
                  onChange={(e) => setFormData({ ...formData, meetingRevenue: Number(e.target.value) })}
                  className="form-input pr-8"
                  min="0"
                />
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <label className="form-label">סוג פעילות *</label>
          <select
            value={formData.activityType}
            onChange={(e) => {
              const newActivityType = e.target.value as ActivityType;
              setFormData({ 
                ...formData, 
                activityType: newActivityType,
                isOnline: newActivityType === 'online'
              });
            }}
            className="form-input w-36"
          >
            <option value="frontal">פרונטלי</option>
            <option value="online">אונליין</option>
            <option value="private_lesson">פרטי</option>
          </select>
        </div>

        <div className="flex items-center gap-6 mt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.sendParentReminders}
              onChange={(e) => setFormData({ ...formData, sendParentReminders: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">שלח תזכורות להורים</span>
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button type="submit" className="btn btn-primary" disabled={isLoading}>
          {isLoading ? 'יוצר מחזור...' : 'צור מחזור'}
        </button>
      </div>
    </form>
  );
}

// Cycle Edit Form
interface CycleEditFormProps {
  cycle: Cycle;
  courses: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  instructors: { id: string; name: string }[];
  onSubmit: (data: Partial<Cycle>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function CycleEditForm({ cycle, courses, branches, instructors, onSubmit, onCancel, isLoading }: CycleEditFormProps) {
  const formatTimeForInput = (time: string) => {
    if (time.includes('T')) {
      const date = new Date(time);
      return date.toISOString().substring(11, 16);
    }
    return time.substring(0, 5);
  };

  const [formData, setFormData] = useState({
    name: cycle.name,
    courseId: cycle.courseId,
    branchId: cycle.branchId,
    instructorId: cycle.instructorId,
    type: cycle.type,
    status: cycle.status,
    dayOfWeek: cycle.dayOfWeek,
    startTime: formatTimeForInput(cycle.startTime),
    endTime: formatTimeForInput(cycle.endTime),
    totalMeetings: cycle.totalMeetings,
    pricePerStudent: cycle.pricePerStudent || 0,
    meetingRevenue: cycle.meetingRevenue || 0,
    studentCount: cycle.studentCount || 0,
    maxStudents: cycle.maxStudents || 15,
    sendParentReminders: cycle.sendParentReminders,
    isOnline: cycle.isOnline,
    activityType: cycle.activityType || 'frontal',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const priceValue = Number(formData.pricePerStudent);
    const meetingRevenueValue = Number(formData.meetingRevenue);
    const studentCountValue = Number(formData.studentCount);
    const maxStudentsValue = Number(formData.maxStudents);
    
    // Calculate duration from start/end times
    const [startHour, startMin] = formData.startTime.split(':').map(Number);
    const [endHour, endMin] = formData.endTime.split(':').map(Number);
    const calculatedDuration = (endHour * 60 + endMin) - (startHour * 60 + startMin);
    const durationMinutes = calculatedDuration > 0 ? calculatedDuration : 60; // default to 60 if invalid
    
    onSubmit({
      name: formData.name,
      courseId: formData.courseId,
      branchId: formData.branchId,
      instructorId: formData.instructorId,
      type: formData.type,
      status: formData.status,
      dayOfWeek: formData.dayOfWeek,
      startTime: formData.startTime,
      endTime: formData.endTime,
      durationMinutes,
      totalMeetings: Number(formData.totalMeetings),
      pricePerStudent: (formData.type === 'private' || formData.type === 'institutional_per_child') && priceValue > 0 ? priceValue : undefined,
      meetingRevenue: formData.type === 'institutional_fixed' && meetingRevenueValue > 0 ? meetingRevenueValue : undefined,
      studentCount: formData.type === 'institutional_per_child' && studentCountValue > 0 ? studentCountValue : undefined,
      maxStudents: maxStudentsValue > 0 ? maxStudentsValue : undefined,
      sendParentReminders: formData.sendParentReminders,
      isOnline: formData.isOnline,
      activityType: formData.activityType,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="form-label">שם המחזור *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="form-input"
            required
          />
        </div>

        <div>
          <label className="form-label">קורס *</label>
          <select
            value={formData.courseId}
            onChange={(e) => setFormData({ ...formData, courseId: e.target.value })}
            className="form-input"
            required
          >
            <option value="">בחר קורס</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label">סניף *</label>
          <select
            value={formData.branchId}
            onChange={(e) => setFormData({ ...formData, branchId: e.target.value })}
            className="form-input"
            required
          >
            <option value="">בחר סניף</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label">מדריך *</label>
          <select
            value={formData.instructorId}
            onChange={(e) => setFormData({ ...formData, instructorId: e.target.value })}
            className="form-input"
            required
          >
            <option value="">בחר מדריך</option>
            {instructors.map((instructor) => (
              <option key={instructor.id} value={instructor.id}>
                {instructor.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label">סוג מחזור</label>
          <select
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value as CycleType })}
            className="form-input"
          >
            <option value="private">פרטי</option>
            <option value="institutional_per_child">מוסדי (פר ילד)</option>
            <option value="institutional_fixed">מוסדי (סכום קבוע)</option>
          </select>
        </div>

        <div>
          <label className="form-label">סטטוס</label>
          <select
            value={formData.status}
            onChange={(e) => setFormData({ ...formData, status: e.target.value as CycleStatus })}
            className="form-input"
          >
            <option value="active">פעיל</option>
            <option value="completed">הושלם</option>
            <option value="cancelled">בוטל</option>
          </select>
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-700 mb-4">לוח זמנים</h4>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="form-label">יום בשבוע</label>
            <select
              value={formData.dayOfWeek}
              onChange={(e) => setFormData({ ...formData, dayOfWeek: e.target.value as DayOfWeek })}
              className="form-input"
            >
              <option value="sunday">ראשון</option>
              <option value="monday">שני</option>
              <option value="tuesday">שלישי</option>
              <option value="wednesday">רביעי</option>
              <option value="thursday">חמישי</option>
              <option value="friday">שישי</option>
            </select>
          </div>

          <div>
            <label className="form-label">שעת התחלה</label>
            <input
              type="time"
              value={formData.startTime}
              onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
              className="form-input"
            />
          </div>

          <div>
            <label className="form-label">שעת סיום</label>
            <input
              type="time"
              value={formData.endTime}
              onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
              className="form-input"
            />
          </div>

          <div>
            <label className="form-label">סה"כ מפגשים</label>
            <input
              type="number"
              value={formData.totalMeetings}
              onChange={(e) => setFormData({ ...formData, totalMeetings: Number(e.target.value) })}
              className="form-input"
              min="1"
            />
          </div>
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-700 mb-4">הגדרות נוספות</h4>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="form-label">מקסימום תלמידים</label>
            <input
              type="number"
              value={formData.maxStudents}
              onChange={(e) => setFormData({ ...formData, maxStudents: Number(e.target.value) })}
              className="form-input"
              min="1"
            />
          </div>

          {(formData.type === 'private' || formData.type === 'institutional_per_child') && (
            <div>
              <label className="form-label">מחיר לתלמיד {formData.type === 'institutional_per_child' ? '(למפגש)' : ''}</label>
              <div className="relative">
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
                <input
                  type="number"
                  value={formData.pricePerStudent}
                  onChange={(e) => setFormData({ ...formData, pricePerStudent: Number(e.target.value) })}
                  className="form-input pr-8"
                  min="0"
                />
              </div>
            </div>
          )}

          {formData.type === 'institutional_per_child' && (
            <div>
              <label className="form-label">מספר נרשמים</label>
              <input
                type="number"
                value={formData.studentCount}
                onChange={(e) => setFormData({ ...formData, studentCount: Number(e.target.value) })}
                className="form-input"
                min="0"
              />
            </div>
          )}

          {formData.type === 'institutional_fixed' && (
            <div>
              <label className="form-label">הכנסה למפגש</label>
              <div className="relative">
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
                <input
                  type="number"
                  value={formData.meetingRevenue}
                  onChange={(e) => setFormData({ ...formData, meetingRevenue: Number(e.target.value) })}
                  className="form-input pr-8"
                  min="0"
                />
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <label className="form-label">סוג פעילות *</label>
          <select
            value={formData.activityType}
            onChange={(e) => {
              const newActivityType = e.target.value as ActivityType;
              setFormData({ 
                ...formData, 
                activityType: newActivityType,
                isOnline: newActivityType === 'online'
              });
            }}
            className="form-input w-36"
          >
            <option value="frontal">פרונטלי</option>
            <option value="online">אונליין</option>
            <option value="private_lesson">פרטי</option>
          </select>
        </div>

        <div className="flex items-center gap-6 mt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.sendParentReminders}
              onChange={(e) => setFormData({ ...formData, sendParentReminders: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">שלח תזכורות להורים</span>
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button type="submit" className="btn btn-primary" disabled={isLoading}>
          {isLoading ? 'שומר...' : 'שמור שינויים'}
        </button>
      </div>
    </form>
  );
}

// Bulk Edit Form
interface BulkEditFormProps {
  selectedCount: number;
  instructors: { id: string; name: string }[];
  onSubmit: (data: Partial<Cycle>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function BulkEditForm({ selectedCount, instructors, onSubmit, onCancel, isLoading }: BulkEditFormProps) {
  const [formData, setFormData] = useState<{
    status?: CycleStatus;
    instructorId?: string;
    meetingRevenue?: number;
    pricePerStudent?: number;
    studentCount?: number;
    sendParentReminders?: boolean;
    activityType?: ActivityType;
  }>({});

  const [enabledFields, setEnabledFields] = useState<Set<string>>(new Set());

  const toggleField = (field: string) => {
    setEnabledFields(prev => {
      const newSet = new Set(prev);
      if (newSet.has(field)) {
        newSet.delete(field);
        // Also clear the value
        setFormData(f => {
          const newData = { ...f };
          delete newData[field as keyof typeof f];
          return newData;
        });
      } else {
        newSet.add(field);
      }
      return newSet;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Only submit fields that are enabled
    const dataToSubmit: Partial<Cycle> = {};
    if (enabledFields.has('status') && formData.status) {
      dataToSubmit.status = formData.status;
    }
    if (enabledFields.has('instructorId') && formData.instructorId) {
      dataToSubmit.instructorId = formData.instructorId;
    }
    if (enabledFields.has('meetingRevenue') && formData.meetingRevenue !== undefined) {
      dataToSubmit.meetingRevenue = formData.meetingRevenue;
    }
    if (enabledFields.has('pricePerStudent') && formData.pricePerStudent !== undefined) {
      dataToSubmit.pricePerStudent = formData.pricePerStudent;
    }
    if (enabledFields.has('studentCount') && formData.studentCount !== undefined) {
      dataToSubmit.studentCount = formData.studentCount;
    }
    if (enabledFields.has('sendParentReminders') && formData.sendParentReminders !== undefined) {
      dataToSubmit.sendParentReminders = formData.sendParentReminders;
    }
    if (enabledFields.has('activityType') && formData.activityType) {
      dataToSubmit.activityType = formData.activityType;
    }

    if (Object.keys(dataToSubmit).length === 0) {
      alert('יש לבחור לפחות שדה אחד לעדכון');
      return;
    }

    onSubmit(dataToSubmit);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <p className="text-gray-600 mb-4">
        בחר את השדות שברצונך לעדכן. רק שדות מסומנים יעודכנו ב-{selectedCount} מחזורים.
      </p>

      <div className="space-y-4">
        {/* Status */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabledFields.has('status')}
            onChange={() => toggleField('status')}
            className="mt-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label className="form-label">סטטוס</label>
            <select
              value={formData.status || ''}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as CycleStatus })}
              className="form-input"
              disabled={!enabledFields.has('status')}
            >
              <option value="">בחר סטטוס</option>
              <option value="active">פעיל</option>
              <option value="completed">הושלם</option>
              <option value="cancelled">בוטל</option>
            </select>
          </div>
        </div>

        {/* Instructor */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabledFields.has('instructorId')}
            onChange={() => toggleField('instructorId')}
            className="mt-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label className="form-label">מדריך</label>
            <select
              value={formData.instructorId || ''}
              onChange={(e) => setFormData({ ...formData, instructorId: e.target.value })}
              className="form-input"
              disabled={!enabledFields.has('instructorId')}
            >
              <option value="">בחר מדריך</option>
              {instructors.map((instructor) => (
                <option key={instructor.id} value={instructor.id}>
                  {instructor.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Meeting Revenue (for institutional_fixed) */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabledFields.has('meetingRevenue')}
            onChange={() => toggleField('meetingRevenue')}
            className="mt-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label className="form-label">הכנסה למפגש (מוסדי - סכום קבוע)</label>
            <div className="relative">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
              <input
                type="number"
                value={formData.meetingRevenue || ''}
                onChange={(e) => setFormData({ ...formData, meetingRevenue: Number(e.target.value) })}
                className="form-input pr-8"
                min="0"
                disabled={!enabledFields.has('meetingRevenue')}
              />
            </div>
          </div>
        </div>

        {/* Price Per Student */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabledFields.has('pricePerStudent')}
            onChange={() => toggleField('pricePerStudent')}
            className="mt-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label className="form-label">מחיר לתלמיד (פרטי / מוסדי פר ילד)</label>
            <div className="relative">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
              <input
                type="number"
                value={formData.pricePerStudent || ''}
                onChange={(e) => setFormData({ ...formData, pricePerStudent: Number(e.target.value) })}
                className="form-input pr-8"
                min="0"
                disabled={!enabledFields.has('pricePerStudent')}
              />
            </div>
          </div>
        </div>

        {/* Student Count */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabledFields.has('studentCount')}
            onChange={() => toggleField('studentCount')}
            className="mt-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label className="form-label">מספר תלמידים (מוסדי פר ילד)</label>
            <input
              type="number"
              value={formData.studentCount || ''}
              onChange={(e) => setFormData({ ...formData, studentCount: Number(e.target.value) })}
              className="form-input"
              min="0"
              disabled={!enabledFields.has('studentCount')}
            />
          </div>
        </div>

        {/* Activity Type */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabledFields.has('activityType')}
            onChange={() => toggleField('activityType')}
            className="mt-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label className="form-label">סוג פעילות</label>
            <select
              value={formData.activityType || ''}
              onChange={(e) => setFormData({ ...formData, activityType: e.target.value as ActivityType })}
              className="form-input"
              disabled={!enabledFields.has('activityType')}
            >
              <option value="">בחר סוג</option>
              <option value="frontal">פרונטלי</option>
              <option value="online">אונליין</option>
              <option value="private_lesson">פרטי</option>
            </select>
          </div>
        </div>

        {/* Send Parent Reminders */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabledFields.has('sendParentReminders')}
            onChange={() => toggleField('sendParentReminders')}
            className="mt-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.sendParentReminders ?? false}
                onChange={(e) => setFormData({ ...formData, sendParentReminders: e.target.checked })}
                disabled={!enabledFields.has('sendParentReminders')}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">שלח תזכורות להורים</span>
            </label>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={isLoading || enabledFields.size === 0}
        >
          {isLoading ? 'מעדכן...' : `עדכן ${selectedCount} מחזורים`}
        </button>
      </div>
    </form>
  );
}
