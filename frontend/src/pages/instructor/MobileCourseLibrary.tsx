/**
 * Course Library — Instructor view
 * Shows ALL courses with Drive materials (regardless of which cycles the instructor teaches)
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search, ChevronLeft, X } from 'lucide-react';
import { CourseMaterials } from '../../components/CourseMaterials';
import api from '../../api/client';
import type { Course } from '../../types';
import { categoryHebrew } from '../../types';

interface CoursesResponse {
  data: Course[];
}

export default function MobileCourseLibrary() {
  const [search, setSearch] = useState('');
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  const { data, isLoading } = useQuery<CoursesResponse>({
    queryKey: ['courses-library'],
    queryFn: async () => {
      const res = await api.get<CoursesResponse>('/courses?limit=200&isActive=true');
      return res.data;
    },
    staleTime: 10 * 60 * 1000,
  });

  // Only show courses that have a Drive folder
  const courses = (data?.data || []).filter(
    (c) => c.materialsFolderId && c.name.toLowerCase().includes(search.toLowerCase())
  );

  // Course detail view
  if (selectedCourse) {
    return (
      <div className="min-h-full bg-gray-50" dir="rtl">
        {/* Header */}
        <div className="bg-white border-b px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button
            onClick={() => setSelectedCourse(null)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900 truncate">{selectedCourse.name}</h2>
            <p className="text-xs text-gray-500">{categoryHebrew[selectedCourse.category]}</p>
          </div>
        </div>

        {/* Materials */}
        <div className="p-4">
          <CourseMaterials
            courseId={selectedCourse.id}
            courseName={selectedCourse.name}
            compact={false}
          />
        </div>
      </div>
    );
  }

  // Course list view
  return (
    <div className="min-h-full bg-gray-50" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 sticky top-0 z-10">
        <h1 className="text-lg font-bold text-gray-900 mb-3">📚 ספריית קורסים</h1>
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש קורס..."
            className="w-full pr-9 pl-8 py-2 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2">
              <X size={14} className="text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="p-4 space-y-2">
        {isLoading && (
          <div className="text-center text-gray-400 py-10">טוען קורסים...</div>
        )}
        {!isLoading && courses.length === 0 && (
          <div className="text-center text-gray-400 py-10">
            {search ? 'לא נמצאו קורסים' : 'אין קורסים עם חומרי לימוד'}
          </div>
        )}
        {courses.map((course) => (
          <button
            key={course.id}
            onClick={() => setSelectedCourse(course)}
            className="w-full bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3 hover:shadow-md active:scale-[0.98] transition-all text-right"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <BookOpen size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{course.name}</p>
              <p className="text-xs text-gray-500">{categoryHebrew[course.category]}</p>
            </div>
            <ChevronLeft size={16} className="text-gray-400 shrink-0" />
          </button>
        ))}
        {!isLoading && (
          <p className="text-center text-xs text-gray-400 pt-2">{courses.length} קורסים עם חומרים</p>
        )}
      </div>
    </div>
  );
}
