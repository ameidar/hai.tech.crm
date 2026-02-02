import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Plus, Edit2, Trash2, Star, Globe, X, Save, Filter } from 'lucide-react';
import { api } from '../hooks/useApi';

interface SavedView {
  id: string;
  name: string;
  entity: string;
  filters: Array<{ field: string; operator: string; value?: any }>;
  columns: string[];
  sortBy?: string;
  sortOrder?: string;
  isDefault: boolean;
  isPublic: boolean;
  createdBy: { id: string; name: string };
}

interface Field {
  name: string;
  label: string;
  type: string;
}

interface ViewSelectorProps {
  entity: string;
  onApplyView: (filters: any[], columns: string[], sortBy?: string, sortOrder?: string) => void;
  onViewSelect?: (viewId: string | null) => void;
  currentFilters?: any[];
}

const OPERATORS = [
  { value: 'equals', label: 'שווה ל' },
  { value: 'contains', label: 'מכיל' },
  { value: 'gt', label: 'גדול מ' },
  { value: 'gte', label: 'גדול או שווה ל' },
  { value: 'lt', label: 'קטן מ' },
  { value: 'lte', label: 'קטן או שווה ל' },
  { value: 'isNull', label: 'ריק' },
  { value: 'isNotNull', label: 'לא ריק' },
  { value: 'today', label: 'היום' },
  { value: 'thisWeek', label: 'השבוע' },
  { value: 'thisMonth', label: 'החודש' },
];

export default function ViewSelector({ entity, onApplyView, onViewSelect, currentFilters }: ViewSelectorProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingView, setEditingView] = useState<SavedView | null>(null);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);

  // Form state
  const [viewName, setViewName] = useState('');
  const [filters, setFilters] = useState<Array<{ field: string; operator: string; value: string }>>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isPublic, setIsPublic] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  // Fetch views for this entity
  const { data: views = [] } = useQuery<SavedView[]>({
    queryKey: ['views', entity],
    queryFn: () => api.get(`/views?entity=${entity}`).then(r => r.data),
  });

  // Fetch available fields
  const { data: fields = [] } = useQuery<Field[]>({
    queryKey: ['view-fields', entity],
    queryFn: () => api.get(`/views/fields/${entity}`).then(r => r.data),
  });

  // Create view mutation
  const createView = useMutation({
    mutationFn: (data: any) => api.post('/views', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views', entity] });
      resetForm();
      setIsEditing(false);
    },
  });

  // Update view mutation
  const updateView = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/views/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views', entity] });
      resetForm();
      setIsEditing(false);
    },
  });

  // Delete view mutation
  const deleteView = useMutation({
    mutationFn: (id: string) => api.delete(`/views/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views', entity] });
      if (selectedViewId) setSelectedViewId(null);
    },
  });

  // Apply default view on load
  useEffect(() => {
    const defaultView = views.find(v => v.isDefault);
    if (defaultView && !selectedViewId) {
      applyView(defaultView);
    }
  }, [views]);

  const resetForm = () => {
    setViewName('');
    setFilters([]);
    setSelectedColumns(fields.map(f => f.name));
    setSortBy('');
    setSortOrder('desc');
    setIsPublic(false);
    setIsDefault(false);
    setEditingView(null);
  };

  const applyView = (view: SavedView) => {
    setSelectedViewId(view.id);
    onApplyView(view.filters, view.columns, view.sortBy, view.sortOrder);
    onViewSelect?.(view.id);
    setIsOpen(false);
  };

  const clearView = () => {
    setSelectedViewId(null);
    onApplyView([], fields.map(f => f.name));
    onViewSelect?.(null);
  };

  const startEditing = (view?: SavedView) => {
    if (view) {
      setEditingView(view);
      setViewName(view.name);
      setFilters(view.filters.map(f => ({ ...f, value: f.value?.toString() || '' })));
      setSelectedColumns(view.columns);
      setSortBy(view.sortBy || '');
      setSortOrder((view.sortOrder as 'asc' | 'desc') || 'desc');
      setIsPublic(view.isPublic);
      setIsDefault(view.isDefault);
    } else {
      resetForm();
      setSelectedColumns(fields.map(f => f.name));
    }
    setIsEditing(true);
  };

  const addFilter = () => {
    setFilters([...filters, { field: fields[0]?.name || '', operator: 'equals', value: '' }]);
  };

  const removeFilter = (index: number) => {
    setFilters(filters.filter((_, i) => i !== index));
  };

  const updateFilter = (index: number, key: string, value: string) => {
    const newFilters = [...filters];
    newFilters[index] = { ...newFilters[index], [key]: value };
    setFilters(newFilters);
  };

  const toggleColumn = (columnName: string) => {
    if (selectedColumns.includes(columnName)) {
      setSelectedColumns(selectedColumns.filter(c => c !== columnName));
    } else {
      setSelectedColumns([...selectedColumns, columnName]);
    }
  };

  const saveView = () => {
    const viewData = {
      name: viewName,
      entity,
      filters: filters.map(f => ({
        field: f.field,
        operator: f.operator,
        value: ['isNull', 'isNotNull', 'today', 'thisWeek', 'thisMonth'].includes(f.operator) 
          ? undefined 
          : f.value,
      })),
      columns: selectedColumns,
      sortBy: sortBy || undefined,
      sortOrder: sortBy ? sortOrder : undefined,
      isPublic,
      isDefault,
    };

    if (editingView) {
      updateView.mutate({ id: editingView.id, data: viewData });
    } else {
      createView.mutate(viewData);
    }
  };

  const selectedView = views.find(v => v.id === selectedViewId);

  return (
    <div className="relative">
      {/* View Button */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="btn btn-secondary flex items-center gap-2"
        >
          <Eye size={18} />
          <span>{selectedView ? selectedView.name : 'תצוגות'}</span>
        </button>
        {selectedView && (
          <button
            onClick={clearView}
            className="p-2 text-gray-500 hover:text-gray-700"
            title="נקה תצוגה"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border z-50">
          {!isEditing ? (
            <>
              {/* Views List */}
              <div className="p-3 border-b">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">תצוגות שמורות</h3>
                  <button
                    onClick={() => startEditing()}
                    className="text-blue-600 hover:text-blue-700 text-sm flex items-center gap-1"
                  >
                    <Plus size={14} />
                    חדש
                  </button>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto">
                {views.length === 0 ? (
                  <p className="p-4 text-gray-500 text-sm text-center">
                    אין תצוגות שמורות
                  </p>
                ) : (
                  views.map(view => (
                    <div
                      key={view.id}
                      className={`flex items-center justify-between p-3 hover:bg-gray-50 cursor-pointer ${
                        selectedViewId === view.id ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => applyView(view)}
                    >
                      <div className="flex items-center gap-2">
                        {view.isDefault && <Star size={14} className="text-yellow-500" />}
                        {view.isPublic && <Globe size={14} className="text-green-500" />}
                        <span className="text-sm">{view.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(view);
                          }}
                          className="p-1 text-gray-400 hover:text-blue-600"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('למחוק את התצוגה?')) {
                              deleteView.mutate(view.id);
                            }
                          }}
                          className="p-1 text-gray-400 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            /* Edit Form */
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium">
                  {editingView ? 'עריכת תצוגה' : 'תצוגה חדשה'}
                </h3>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    resetForm();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Name */}
              <div className="mb-4">
                <label className="form-label">שם התצוגה</label>
                <input
                  type="text"
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  className="form-input"
                  placeholder="לדוגמה: פגישות היום"
                />
              </div>

              {/* Filters */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="form-label mb-0">סינונים</label>
                  <button
                    onClick={addFilter}
                    className="text-blue-600 hover:text-blue-700 text-sm flex items-center gap-1"
                  >
                    <Plus size={14} />
                    הוסף
                  </button>
                </div>
                
                {filters.length === 0 ? (
                  <p className="text-sm text-gray-500">ללא סינון (כל הרשומות)</p>
                ) : (
                  <div className="space-y-2">
                    {filters.map((filter, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <select
                          value={filter.field}
                          onChange={(e) => updateFilter(index, 'field', e.target.value)}
                          className="form-input flex-1 text-sm py-1"
                        >
                          {fields.map(f => (
                            <option key={f.name} value={f.name}>{f.label}</option>
                          ))}
                        </select>
                        <select
                          value={filter.operator}
                          onChange={(e) => updateFilter(index, 'operator', e.target.value)}
                          className="form-input flex-1 text-sm py-1"
                        >
                          {OPERATORS.map(op => (
                            <option key={op.value} value={op.value}>{op.label}</option>
                          ))}
                        </select>
                        {!['isNull', 'isNotNull', 'today', 'thisWeek', 'thisMonth'].includes(filter.operator) && (
                          <input
                            type="text"
                            value={filter.value}
                            onChange={(e) => updateFilter(index, 'value', e.target.value)}
                            className="form-input flex-1 text-sm py-1"
                            placeholder="ערך"
                          />
                        )}
                        <button
                          onClick={() => removeFilter(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Columns */}
              <div className="mb-4">
                <label className="form-label">עמודות להציג</label>
                <div className="flex flex-wrap gap-2">
                  {fields.map(field => (
                    <label
                      key={field.name}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm cursor-pointer ${
                        selectedColumns.includes(field.name)
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedColumns.includes(field.name)}
                        onChange={() => toggleColumn(field.name)}
                        className="hidden"
                      />
                      {field.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Sort */}
              <div className="mb-4 flex gap-2">
                <div className="flex-1">
                  <label className="form-label">מיון לפי</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="form-input text-sm"
                  >
                    <option value="">ללא מיון</option>
                    {fields.map(f => (
                      <option key={f.name} value={f.name}>{f.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="form-label">סדר</label>
                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                    className="form-input text-sm"
                  >
                    <option value="asc">עולה</option>
                    <option value="desc">יורד</option>
                  </select>
                </div>
              </div>

              {/* Options */}
              <div className="mb-4 flex gap-4">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                  />
                  תצוגת ברירת מחדל
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                  />
                  ציבורית
                </label>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={saveView}
                  disabled={!viewName || selectedColumns.length === 0}
                  className="btn btn-primary flex-1"
                >
                  <Save size={16} />
                  שמור
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    resetForm();
                  }}
                  className="btn btn-secondary"
                >
                  ביטול
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
