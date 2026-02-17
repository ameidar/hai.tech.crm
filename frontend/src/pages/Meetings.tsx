import React, { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  X,
  Edit,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calculator,
  Filter,
} from 'lucide-react';
import { useMeetings, useRecalculateMeeting, useViewData, useBulkUpdateMeetingStatus, useUpdateMeeting, useBulkUpdateMeetings, useBulkRecalculateMeetings } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import MeetingDetailModal from '../components/MeetingDetailModal';
import MeetingEditModal from '../components/MeetingEditModal';
import BulkMeetingEditModal, { type BulkMeetingUpdateData } from '../components/BulkMeetingEditModal';
import ViewSelector from '../components/ViewSelector';
import { meetingStatusHebrew } from '../types';
import type { Meeting, MeetingStatus } from '../types';

export default function Meetings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'date' | 'view'>('date');
  const [viewColumns, setViewColumns] = useState<string[]>([]);
  
  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>('');
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);

  // Read filters from URL
  const selectedDate = searchParams.get('date') || new Date().toISOString().split('T')[0];
  const instructorFilter = searchParams.get('instructorId') || '';
  const sortColumn = searchParams.get('sort') || 'startTime';
  const sortDirection = (searchParams.get('dir') as 'asc' | 'desc') || 'asc';

  // Helper to update URL params
  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    setSearchParams(newParams, { replace: true });
  };

  const setSelectedDate = (v: string) => updateFilter('date', v);
  const setInstructorFilter = (v: string) => updateFilter('instructorId', v);
  const setSortColumn = (v: string) => updateFilter('sort', v);
  const setSortDirection = (v: 'asc' | 'desc') => updateFilter('dir', v);
  
  // Column definitions for meetings
  const allColumns: Record<string, { label: string; render: (m: Meeting) => React.ReactNode }> = {
    scheduledDate: {
      label: 'תאריך',
      render: (m) => m.scheduledDate ? new Date(m.scheduledDate).toLocaleDateString('he-IL') : '-'
    },
    startTime: {
      label: 'שעה',
      render: (m) => `${formatTime(m.startTime)} - ${formatTime(m.endTime)}`
    },
    'cycle.name': {
      label: 'מחזור',
      render: (m) => m.cycle?.name ? (
        <Link to={`/cycles/${m.cycleId}`} className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
          {m.cycle.name}
        </Link>
      ) : '-'
    },
    'cycle.course.name': {
      label: 'קורס',
      render: (m) => m.cycle?.course?.name || '-'
    },
    'cycle.branch.name': {
      label: 'סניף',
      render: (m) => m.cycle?.branch?.name || '-'
    },
    'instructor.name': {
      label: 'מדריך',
      render: (m) => m.instructor?.name || '-'
    },
    status: {
      label: 'סטטוס',
      render: (m) => (
        <span className={`badge ${getStatusBadgeClass(m.status)}`}>
          {meetingStatusHebrew[m.status]}
        </span>
      )
    },
    revenue: {
      label: 'הכנסה',
      render: (m) => m.status === 'completed' 
        ? <span className="text-green-600">{(m.revenue || 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 })}</span>
        : '-'
    },
    instructorPayment: {
      label: 'עלות',
      render: (m) => m.status === 'completed'
        ? <span className="text-red-600">{(m.instructorPayment || 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 })}</span>
        : '-'
    },
    profit: {
      label: 'רווח',
      render: (m) => {
        if (m.status !== 'completed') return '-';
        // Use adjustedProfit (includes cycle expenses share) if available, otherwise fall back to profit
        const profitValue = (m as any).adjustedProfit !== undefined ? (m as any).adjustedProfit : (m.profit || 0);
        const cycleExpenseShare = (m as any).cycleExpenseShare;
        return (
          <span 
            className={profitValue >= 0 ? 'text-green-600' : 'text-red-600'}
            title={cycleExpenseShare ? `לפני הוצאות מחזור: ₪${(m.profit || 0).toLocaleString()}, הוצאות מחזור: ₪${cycleExpenseShare.toLocaleString()}` : undefined}
          >
            {profitValue.toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 })}
          </span>
        );
      }
    },
    subject: {
      label: 'נושא',
      render: (m) => (m as any).subject || '-'
    },
    notes: {
      label: 'הערות',
      render: (m) => (m as any).notes || '-'
    }
  };
  
  // Default columns when no view is selected
  const defaultColumns = ['scheduledDate', 'startTime', 'cycle.name', 'cycle.course.name', 'cycle.branch.name', 'instructor.name', 'status', 'revenue', 'instructorPayment', 'profit'];
  
  // Get active columns (from view or default)
  const activeColumns = viewMode === 'view' && viewColumns.length > 0 ? viewColumns : defaultColumns;

  const { data: meetings, isLoading, refetch } = useMeetings({ 
    date: instructorFilter ? undefined : selectedDate,  // When filtering by instructor, show all dates
    instructorId: instructorFilter || undefined,
  });
  
  // Build date filter for view data - filter by selectedDate
  // Use UTC midnight directly since DB stores dates at 00:00:00 UTC
  const dateFilter = useMemo(() => {
    // selectedDate is "YYYY-MM-DD", create UTC dates directly
    const startUTC = new Date(selectedDate + 'T00:00:00.000Z');
    const endUTC = new Date(startUTC);
    endUTC.setUTCDate(endUTC.getUTCDate() + 1);
    return [
      { field: 'scheduledDate', operator: 'gte', value: startUTC.toISOString() },
      { field: 'scheduledDate', operator: 'lt', value: endUTC.toISOString() },
    ];
  }, [selectedDate]);
  
  const { data: viewData, isLoading: viewLoading } = useViewData(activeViewId, dateFilter);
  const recalculateMeeting = useRecalculateMeeting();
  const bulkUpdateStatus = useBulkUpdateMeetingStatus();
  const updateMeeting = useUpdateMeeting();
  const bulkUpdateMeetings = useBulkUpdateMeetings();
  const bulkRecalculate = useBulkRecalculateMeetings();

  // Sort handler
  const handleSort = (column: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (sortColumn === column) {
      newParams.set('dir', sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      newParams.set('sort', column);
      newParams.set('dir', 'asc');
    }
    setSearchParams(newParams, { replace: true });
  };

  // Get nested value from object
  const getNestedValue = (obj: any, path: string): any => {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  };

  // Determine which data to display based on view mode
  const rawMeetings = viewMode === 'view' && viewData?.data 
    ? viewData.data as Meeting[]
    : meetings || [];

  // Sort meetings
  const displayMeetings = useMemo(() => {
    const sorted = [...rawMeetings].sort((a, b) => {
      let aVal = getNestedValue(a, sortColumn);
      let bVal = getNestedValue(b, sortColumn);
      
      // Handle nulls
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      
      // Handle dates
      if (sortColumn === 'scheduledDate') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }
      
      // Handle numbers
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      // Handle strings
      const comparison = String(aVal).localeCompare(String(bVal), 'he');
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [rawMeetings, sortColumn, sortDirection]);

  // Handle edit meeting save
  const handleEditSave = async (id: string, data: Partial<Meeting>) => {
    await updateMeeting.mutateAsync({ id, data });
    setEditingMeeting(null);
    refetch();
  };

  // Handle bulk edit save
  const handleBulkEditSave = async (data: BulkMeetingUpdateData) => {
    if (selectedIds.size === 0) return;

    try {
      const result = await bulkUpdateMeetings.mutateAsync({
        ids: Array.from(selectedIds),
        data,
      });

      if (result.errors && result.errors.length > 0) {
        alert(`עודכנו ${result.updated} פגישות. שגיאות: ${result.errors.join(', ')}`);
      } else {
        alert(`עודכנו ${result.updated} פגישות בהצלחה`);
      }

      setShowBulkEditModal(false);
      setSelectedIds(new Set());
      refetch();
    } catch (error) {
      console.error('Failed to bulk update:', error);
      alert('שגיאה בעדכון גורף');
    }
  };
  const displayLoading = viewMode === 'view' ? viewLoading : isLoading;

  const handleApplyView = (filters: any[], columns: string[], sortBy?: string, sortOrder?: string) => {
    // Store columns from view to use in table rendering
    setViewColumns(columns || []);
    
    // If view has a date filter with 'equals' operator, sync the date picker
    const dateFilter = filters?.find(f => f.field === 'date' && f.operator === 'equals' && f.value);
    if (dateFilter) {
      // Parse the date value (could be YYYY-MM-DD or D.M.YYYY format)
      let dateStr = dateFilter.value;
      if (dateStr.includes('.')) {
        // Convert D.M.YYYY to YYYY-MM-DD
        const parts = dateStr.split('.');
        if (parts.length === 3) {
          const day = parts[0].padStart(2, '0');
          const month = parts[1].padStart(2, '0');
          const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
          dateStr = `${year}-${month}-${day}`;
        }
      }
      if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        setSelectedDate(dateStr);
      }
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const formatTime = (time: string) => {
    if (!time) return '--:--';
    if (time.includes('T')) {
      const date = new Date(time);
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    return time.substring(0, 5);
  };

  const changeDate = (days: number) => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + days);
    setSelectedDate(date.toISOString().split('T')[0]);
    setSelectedIds(new Set()); // Clear selection on date change
  };

  const getStatusBadgeClass = (status: MeetingStatus) => {
    switch (status) {
      case 'completed':
        return 'badge-success';
      case 'cancelled':
        return 'badge-danger';
      case 'postponed':
        return 'badge-warning';
      default:
        return 'badge-info';
    }
  };

  const handleRecalculate = async (meetingId: string) => {
    try {
      const result = await recalculateMeeting.mutateAsync(meetingId);
      if (selectedMeeting) {
        setSelectedMeeting({ ...selectedMeeting, ...result });
      }
    } catch (error) {
      console.error('Failed to recalculate meeting:', error);
      alert('שגיאה בחישוב מחדש');
    }
  };

  // Bulk selection handlers
  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === displayMeetings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayMeetings.map(m => m.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkStatus('');
  };

  const handleBulkStatusUpdate = async () => {
    if (!bulkStatus || selectedIds.size === 0) return;
    
    if (!confirm(`לעדכן ${selectedIds.size} פגישות לסטטוס "${meetingStatusHebrew[bulkStatus as MeetingStatus]}"?`)) {
      return;
    }

    try {
      const result = await bulkUpdateStatus.mutateAsync({
        ids: Array.from(selectedIds),
        status: bulkStatus,
      });
      
      if (result.updated > 0) {
        alert(`עודכנו ${result.updated} פגישות בהצלחה!`);
        clearSelection();
        refetch();
      }
      
      if (result.errors && result.errors.length > 0) {
        console.error('Bulk update errors:', result.errors);
        alert(`${result.errors.length} פגישות נכשלו בעדכון`);
      }
    } catch (error) {
      console.error('Failed to bulk update:', error);
      alert('שגיאה בעדכון גורף');
    }
  };

  const handleBulkRecalculate = async () => {
    const idsToRecalculate = selectedIds.size > 0 
      ? Array.from(selectedIds) 
      : displayMeetings.map(m => m.id);
    
    if (idsToRecalculate.length === 0) return;
    
    const message = selectedIds.size > 0 
      ? `לחשב מחדש ${selectedIds.size} פגישות נבחרות?`
      : `לחשב מחדש את כל ${displayMeetings.length} הפגישות בתצוגה?`;
    
    if (!confirm(message)) return;

    try {
      const result = await bulkRecalculate.mutateAsync({ ids: idsToRecalculate, force: true });
      alert(`חושבו מחדש ${result.recalculated} פגישות בהצלחה!`);
      refetch();
    } catch (error) {
      console.error('Failed to bulk recalculate:', error);
      alert('שגיאה בחישוב מחדש');
    }
  };

  const stats = displayMeetings.length > 0
    ? {
        total: displayMeetings.length,
        completed: displayMeetings.filter((m) => m.status === 'completed').length,
        pending: displayMeetings.filter((m) => m.status === 'scheduled').length,
        cancelled: displayMeetings.filter((m) => m.status === 'cancelled').length,
      }
    : null;

  const allSelected = displayMeetings.length > 0 && selectedIds.size === displayMeetings.length;
  const someSelected = selectedIds.size > 0;

  return (
    <>
      <PageHeader
        title="פגישות"
        subtitle={formatDate(selectedDate)}
      />

      <div className="flex-1 p-4 md:p-6 overflow-auto">
        {/* Bulk Actions Bar - Admin only */}
        {someSelected && isAdmin && (
          <div className="mb-4 p-4 bg-blue-600 text-white rounded-lg flex items-center gap-4 flex-wrap animate-in slide-in-from-top">
            <span className="font-semibold bg-white/20 px-3 py-1 rounded-full">
              {selectedIds.size} נבחרו
            </span>
            
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/20 border-0 text-white focus:ring-2 focus:ring-white/50"
            >
              <option value="">-- בחר סטטוס --</option>
              <option value="completed">התקיימה ✓</option>
              <option value="scheduled">מתוכננת 📅</option>
              <option value="cancelled">בוטלה ✗</option>
              <option value="postponed">נדחתה</option>
            </select>
            
            <button
              onClick={handleBulkStatusUpdate}
              disabled={!bulkStatus || bulkUpdateStatus.isPending}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 rounded-lg font-medium transition-colors"
            >
              {bulkUpdateStatus.isPending ? 'מעדכן...' : '🔄 עדכן סטטוס'}
            </button>

            <button
              onClick={() => setShowBulkEditModal(true)}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg font-medium transition-colors flex items-center gap-1"
            >
              <Edit size={16} />
              עריכה גורפת
            </button>

            <button
              onClick={handleBulkRecalculate}
              disabled={bulkRecalculate.isPending}
              className="px-4 py-2 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 rounded-lg font-medium transition-colors flex items-center gap-1"
            >
              <Calculator size={16} />
              {bulkRecalculate.isPending ? 'מחשב...' : 'חישוב מחדש'}
            </button>
            
            <button
              onClick={clearSelection}
              className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors flex items-center gap-1"
            >
              <X size={16} />
              ביטול
            </button>
          </div>
        )}

        {/* Date Navigation */}
        <div className="mb-4 md:mb-6 flex flex-wrap items-center gap-2 md:gap-4">
          <div className="flex items-center gap-1 md:gap-2 bg-white rounded-lg border p-1">
            <button
              onClick={() => changeDate(-1)}
              className="p-2 rounded hover:bg-gray-100 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <ChevronRight size={20} />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setSelectedIds(new Set());
              }}
              className="px-2 md:px-3 py-2 border-0 focus:ring-0 text-sm md:text-base"
            />
            <button
              onClick={() => changeDate(1)}
              className="p-2 rounded hover:bg-gray-100 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <ChevronLeft size={20} />
            </button>
          </div>

          <button
            onClick={() => {
              setSelectedDate(new Date().toISOString().split('T')[0]);
              setSelectedIds(new Set());
            }}
            className="btn btn-secondary min-h-[44px]"
          >
            היום
          </button>

          {/* View Selector */}
          <div className="hidden md:block me-auto">
            <ViewSelector
              entity="meetings"
              onApplyView={handleApplyView}
              onViewSelect={(viewId) => {
                setActiveViewId(viewId);
                if (viewId) {
                  setViewMode('view');
                } else {
                  setViewMode('date');
                  setViewColumns([]);
                }
                setSelectedIds(new Set());
              }}
            />
          </div>

          {stats && stats.total > 0 && (
            <div className="hidden md:flex items-center gap-4 ms-auto text-sm">
              <span className="flex items-center gap-1 font-semibold text-gray-700 bg-gray-100 px-2 py-1 rounded">
                📅 {stats.total} פגישות ביום זה
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {stats.completed} הושלמו
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                {stats.pending} ממתינים
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {stats.cancelled} בוטלו
              </span>
              {isAdmin && (
                <button
                  onClick={handleBulkRecalculate}
                  disabled={bulkRecalculate.isPending}
                  className="btn btn-secondary flex items-center gap-1 text-sm"
                  title="חישוב מחדש לכל הפגישות בתצוגה"
                >
                  <Calculator size={14} />
                  {bulkRecalculate.isPending ? 'מחשב...' : 'חישוב מחדש'}
                </button>
              )}
            </div>
          )}
          {/* Mobile stats summary */}
          {stats && stats.total > 0 && (
            <div className="md:hidden w-full flex items-center gap-3 text-xs mt-1">
              <span className="font-semibold text-gray-700">{stats.total} פגישות</span>
              <span className="text-green-600">{stats.completed} ✓</span>
              <span className="text-blue-600">{stats.pending} ⏳</span>
              <span className="text-red-600">{stats.cancelled} ✗</span>
            </div>
          )}
        </div>

        {/* Meetings List */}
        {displayLoading ? (
          <Loading size="lg" text="טוען פגישות..." />
        ) : displayMeetings && displayMeetings.length > 0 ? (
          <>
          {/* Mobile card view */}
          <div className="md:hidden space-y-2">
            {displayMeetings.map((meeting) => {
              return (
                <div
                  key={meeting.id}
                  onClick={() => setSelectedMeeting(meeting)}
                  className="bg-white rounded-lg border border-gray-100 p-4 cursor-pointer active:bg-gray-50 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-gray-900 text-sm">
                      {meeting.scheduledDate ? new Date(meeting.scheduledDate).toLocaleDateString('he-IL') : ''}{' '}
                      {formatTime(meeting.startTime)} - {formatTime(meeting.endTime)}
                    </span>
                    <span className={`badge ${getStatusBadgeClass(meeting.status)} text-xs`}>
                      {meetingStatusHebrew[meeting.status]}
                    </span>
                  </div>
                  <p className="text-sm text-blue-600 font-medium">{meeting.cycle?.name || '-'}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-sm text-gray-600">{meeting.instructor?.name || '-'}</span>
                    {meeting.status === 'completed' && (
                      <span className="text-xs text-green-600">₪{(meeting.revenue || 0).toLocaleString()}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block card overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th className="w-12">
                    {isAdmin && (
                      <button
                        onClick={toggleSelectAll}
                        className="p-1 hover:bg-gray-200 rounded transition-colors"
                        title={allSelected ? 'בטל בחירת הכל' : 'בחר הכל'}
                      >
                        {allSelected ? (
                          <CheckSquare size={20} className="text-blue-600" />
                        ) : (
                          <Square size={20} className="text-gray-400" />
                        )}
                      </button>
                    )}
                  </th>
                  {activeColumns.filter(col => allColumns[col]).map(col => (
                    <th 
                      key={col} 
                      className="cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort(col)}
                    >
                      <div className="flex items-center gap-1">
                        {allColumns[col].label}
                        {sortColumn === col ? (
                          sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                        ) : (
                          <ArrowUpDown size={14} className="text-gray-300" />
                        )}
                      </div>
                    </th>
                  ))}
                  {isAdmin && <th className="w-16">פעולות</th>}
                </tr>
              </thead>
              <tbody>
                {displayMeetings.map((meeting) => {
                    const isSelected = selectedIds.has(meeting.id);
                    return (
                      <tr 
                        key={meeting.id}
                        className={`cursor-pointer transition-colors ${
                          isSelected 
                            ? 'bg-blue-50 hover:bg-blue-100' 
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          {isAdmin && (
                            <button
                              onClick={() => toggleSelect(meeting.id)}
                              className="p-1 hover:bg-gray-200 rounded transition-colors"
                            >
                              {isSelected ? (
                                <CheckSquare size={20} className="text-blue-600" />
                              ) : (
                                <Square size={20} className="text-gray-400" />
                              )}
                            </button>
                          )}
                        </td>
                        {activeColumns.filter(col => allColumns[col]).map(col => (
                          <td key={col} onClick={() => setSelectedMeeting(meeting)}>
                            {allColumns[col].render(meeting)}
                          </td>
                        ))}
                        {isAdmin && (
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setEditingMeeting(meeting)}
                              className="p-1.5 hover:bg-blue-100 rounded transition-colors text-blue-600"
                              title="עריכה"
                            >
                              <Edit size={16} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
              {displayMeetings && displayMeetings.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 font-medium">
                    <td></td>
                    {activeColumns.filter(col => allColumns[col]).map((col, idx, arr) => {
                      const financialCols = ['revenue', 'instructorPayment', 'profit'];
                      const firstFinancialIdx = arr.findIndex(c => financialCols.includes(c));
                      
                      if (idx === 0) {
                        // First column shows total label
                        const colSpan = firstFinancialIdx > 0 ? firstFinancialIdx : arr.length;
                        return <td key={col} colSpan={colSpan} className="text-start">סה"כ ({displayMeetings.length} פגישות)</td>;
                      }
                      
                      if (idx < firstFinancialIdx) return null; // Skip middle columns (covered by colspan)
                      
                      if (col === 'revenue') {
                        return (
                          <td key={col} className="text-green-600">
                            {displayMeetings
                              .filter((m) => m.status === 'completed')
                              .reduce((sum, m) => sum + Number(m.revenue || 0), 0)
                              .toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 })}
                          </td>
                        );
                      }
                      if (col === 'instructorPayment') {
                        return (
                          <td key={col} className="text-red-600">
                            {displayMeetings
                              .filter((m) => m.status === 'completed')
                              .reduce((sum, m) => sum + Number(m.instructorPayment || 0), 0)
                              .toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 })}
                          </td>
                        );
                      }
                      if (col === 'profit') {
                        const totalProfit = displayMeetings
                          .filter((m) => m.status === 'completed')
                          .reduce((sum, m) => sum + Number((m as any).adjustedProfit !== undefined ? (m as any).adjustedProfit : (m.profit || 0)), 0);
                        return (
                          <td key={col} className={totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {totalProfit.toLocaleString('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0 })}
                          </td>
                        );
                      }
                      return <td key={col}></td>;
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          </>
        ) : (
          <EmptyState
            icon={<Calendar size={64} />}
            title="אין פגישות"
            description={`אין פגישות מתוכננות ל${formatDate(selectedDate)}`}
          />
        )}
      </div>

      {/* Meeting Detail Modal */}
      <MeetingDetailModal
        meeting={selectedMeeting}
        onClose={() => setSelectedMeeting(null)}
        onRecalculate={handleRecalculate}
        isRecalculating={recalculateMeeting.isPending}
        isAdmin={isAdmin}
      />

      {/* Meeting Edit Modal */}
      <MeetingEditModal
        meeting={editingMeeting}
        onClose={() => setEditingMeeting(null)}
        onSave={handleEditSave}
        isSaving={updateMeeting.isPending}
        isAdmin={isAdmin}
      />

      {/* Bulk Edit Modal */}
      <BulkMeetingEditModal
        isOpen={showBulkEditModal}
        selectedCount={selectedIds.size}
        onClose={() => setShowBulkEditModal(false)}
        onSave={handleBulkEditSave}
        isSaving={bulkUpdateMeetings.isPending}
      />
    </>
  );
}
