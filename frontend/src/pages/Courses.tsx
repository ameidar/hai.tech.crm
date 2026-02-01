import { useState } from 'react';
import { Plus, BookOpen, RefreshCcw } from 'lucide-react';
import { useCourses, useCreateCourse, useUpdateCourse } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { categoryHebrew } from '../types';
import type { Course, CourseCategory } from '../types';

export default function Courses() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  const { data: courses, isLoading } = useCourses();
  const createCourse = useCreateCourse();
  const updateCourse = useUpdateCourse();

  const handleAddCourse = async (data: Partial<Course>) => {
    try {
      await createCourse.mutateAsync(data);
      setShowAddModal(false);
    } catch (error) {
      console.error('Failed to create course:', error);
    }
  };

  const handleUpdateCourse = async (data: Partial<Course>) => {
    if (!editingCourse) return;
    try {
      await updateCourse.mutateAsync({ id: editingCourse.id, data });
      setEditingCourse(null);
    } catch (error) {
      console.error('Failed to update course:', error);
    }
  };

  return (
    <>
      <PageHeader
        title="קורסים"
        subtitle={`${courses?.length || 0} קורסים`}
        actions={
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus size={18} />
            קורס חדש
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        {isLoading ? (
          <Loading size="lg" text="טוען קורסים..." />
        ) : courses && courses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                onEdit={() => setEditingCourse(course)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<BookOpen size={64} />}
            title="אין קורסים"
            description="עדיין לא נוספו קורסים למערכת"
            action={
              <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                <Plus size={18} />
                הוסף קורס ראשון
              </button>
            }
          />
        )}
      </div>

      {/* Add Course Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="קורס חדש"
      >
        <CourseForm
          onSubmit={handleAddCourse}
          onCancel={() => setShowAddModal(false)}
          isLoading={createCourse.isPending}
        />
      </Modal>

      {/* Edit Course Modal */}
      <Modal
        isOpen={!!editingCourse}
        onClose={() => setEditingCourse(null)}
        title="עריכת קורס"
      >
        {editingCourse && (
          <CourseForm
            course={editingCourse}
            onSubmit={handleUpdateCourse}
            onCancel={() => setEditingCourse(null)}
            isLoading={updateCourse.isPending}
          />
        )}
      </Modal>
    </>
  );
}

// Course Card
interface CourseCardProps {
  course: Course;
  onEdit: () => void;
}

function CourseCard({ course, onEdit }: CourseCardProps) {
  const categoryColors: Record<CourseCategory, string> = {
    programming: 'bg-blue-100 text-blue-700',
    ai: 'bg-purple-100 text-purple-700',
    robotics: 'bg-orange-100 text-orange-700',
    'printing_3d': 'bg-green-100 text-green-700',
  };

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
          <span className={`badge ${course.isActive ? 'badge-success' : 'badge-gray'}`}>
            {course.isActive ? 'פעיל' : 'לא פעיל'}
          </span>
        </div>

        {course.description && (
          <p className="text-gray-600 text-sm mb-4 line-clamp-2">{course.description}</p>
        )}

        {course.targetAudience && (
          <p className="text-sm text-gray-500 mb-4">
            <span className="font-medium">קהל יעד:</span> {course.targetAudience}
          </p>
        )}

        <div className="flex items-center justify-between pt-4 border-t">
          <div className="flex items-center gap-1 text-gray-500 text-sm">
            <RefreshCcw size={14} />
            <span>{course._count?.cycles || 0} מחזורים</span>
          </div>
          <button
            onClick={onEdit}
            className="text-blue-600 hover:underline text-sm"
          >
            עריכה
          </button>
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div>
        <label className="form-label">שם הקורס *</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="form-input"
          required
        />
      </div>

      <div>
        <label className="form-label">תיאור</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="form-input"
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">קטגוריה *</label>
          <select
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value as CourseCategory })}
            className="form-input"
          >
            <option value="programming">תכנות</option>
            <option value="ai">בינה מלאכותית</option>
            <option value="robotics">רובוטיקה</option>
            <option value="printing_3d">הדפסה תלת-מימדית</option>
          </select>
        </div>

        <div>
          <label className="form-label">קהל יעד</label>
          <input
            type="text"
            value={formData.targetAudience}
            onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })}
            className="form-input"
            placeholder="לדוגמה: כיתות ג-ד"
          />
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
          קורס פעיל
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
