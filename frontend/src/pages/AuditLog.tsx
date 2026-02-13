import { useState } from 'react';
import { FileText, Search, Filter, MessageCircle, Mail, RefreshCcw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';

interface AuditLog {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string;
  oldValue: any;
  newValue: any;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

const entityLabels: Record<string, string> = {
  communication_whatsapp: 'וואטסאפ',
  communication_email: 'אימייל',
  customer: 'לקוח',
  student: 'תלמיד',
  cycle: 'מחזור',
  meeting: 'פגישה',
  instructor: 'מדריך',
  branch: 'סניף',
  course: 'קורס',
  registration: 'רישום',
};

const actionLabels: Record<string, string> = {
  CREATE: 'יצירה',
  UPDATE: 'עדכון',
  DELETE: 'מחיקה',
};

export default function AuditLog() {
  const [entityFilter, setEntityFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit-logs', entityFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (entityFilter) params.append('entity', entityFilter);
      params.append('limit', '100');
      const response = await api.get(`/audit?${params.toString()}`);
      return response.data;
    },
  });

  const logs: AuditLog[] = data?.data || [];

  // Filter by search query
  const filteredLogs = logs.filter((log) => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      log.userName?.toLowerCase().includes(searchLower) ||
      log.entityId?.toLowerCase().includes(searchLower) ||
      JSON.stringify(log.newValue)?.toLowerCase().includes(searchLower)
    );
  });

  const getEntityIcon = (entity: string) => {
    if (entity === 'communication_whatsapp') return <MessageCircle size={16} className="text-green-600" />;
    if (entity === 'communication_email') return <Mail size={16} className="text-blue-600" />;
    return <FileText size={16} className="text-gray-500" />;
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'bg-green-100 text-green-700';
      case 'UPDATE': return 'bg-blue-100 text-blue-700';
      case 'DELETE': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Format a single value for display
  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'כן' : 'לא';
    if (value instanceof Date || (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/))) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        // Check if it's a time-only value (1970-01-01)
        if (date.getFullYear() === 1970) {
          return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString('he-IL');
      }
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  // Render changes between old and new values
  const renderChanges = (action: string, entity: string, oldValue: any, newValue: any) => {
    // For CREATE - show new values
    if (action === 'CREATE') {
      if (!newValue) return '-';
      
      if (entity === 'communication_whatsapp') {
        return (
          <div className="text-sm">
            <p><span className="text-gray-500">לטלפון:</span> {newValue.phone}</p>
            <p className="text-gray-600 truncate max-w-md">{newValue.message}</p>
          </div>
        );
      }
      
      if (entity === 'communication_email') {
        return (
          <div className="text-sm">
            <p><span className="text-gray-500">ל:</span> {newValue.to}</p>
            <p><span className="text-gray-500">נושא:</span> {newValue.subject}</p>
          </div>
        );
      }

      // Show key fields for other entities
      const keyFields = Object.keys(newValue).slice(0, 4);
      return (
        <div className="text-sm space-y-1">
          {keyFields.map(key => (
            <p key={key}>
              <span className="text-gray-500">{key}:</span>{' '}
              <span className="text-green-700">{formatValue(newValue[key])}</span>
            </p>
          ))}
        </div>
      );
    }

    // For DELETE - show old values
    if (action === 'DELETE') {
      if (!oldValue) return '-';
      const keyFields = Object.keys(oldValue).slice(0, 4);
      return (
        <div className="text-sm space-y-1">
          {keyFields.map(key => (
            <p key={key}>
              <span className="text-gray-500">{key}:</span>{' '}
              <span className="text-red-700 line-through">{formatValue(oldValue[key])}</span>
            </p>
          ))}
        </div>
      );
    }

    // For UPDATE - show what changed (old → new)
    if (action === 'UPDATE') {
      if (!oldValue && !newValue) return '-';
      
      // Get all changed fields
      const allKeys = new Set([
        ...(oldValue ? Object.keys(oldValue) : []),
        ...(newValue ? Object.keys(newValue) : [])
      ]);
      
      const changes: { key: string; old: string; new: string }[] = [];
      for (const key of allKeys) {
        const oldVal = oldValue?.[key];
        const newVal = newValue?.[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changes.push({
            key,
            old: formatValue(oldVal),
            new: formatValue(newVal),
          });
        }
      }

      if (changes.length === 0) return '-';

      return (
        <div className="text-sm space-y-1">
          {changes.map(({ key, old, new: newVal }) => (
            <p key={key} className="flex items-center gap-1 flex-wrap">
              <span className="text-gray-500">{key}:</span>{' '}
              <span className="text-red-600 line-through">{old}</span>
              <span className="text-gray-400">→</span>
              <span className="text-green-700 font-medium">{newVal}</span>
            </p>
          ))}
        </div>
      );
    }

    return '-';
  };

  return (
    <>
      <PageHeader
        title="יומן פעילות"
        subtitle={`${filteredLogs.length} רשומות`}
        actions={
          <button onClick={() => refetch()} className="btn btn-secondary">
            <RefreshCcw size={18} />
            רענן
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="חיפוש..."
              className="form-input pr-10 w-full"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter size={18} className="text-gray-400" />
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="form-input"
            >
              <option value="">כל הפעולות</option>
              <option value="communication_whatsapp">וואטסאפ</option>
              <option value="communication_email">אימייל</option>
              <option value="customer">לקוחות</option>
              <option value="student">תלמידים</option>
              <option value="cycle">מחזורים</option>
              <option value="meeting">פגישות</option>
              <option value="instructor">מדריכים</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <Loading size="lg" text="טוען יומן פעילות..." />
        ) : filteredLogs.length > 0 ? (
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">תאריך</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">משתמש</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">פעולה</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">סוג</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">פרטים</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {log.userName || 'מערכת'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${getActionColor(log.action)}`}>
                        {actionLabels[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {getEntityIcon(log.entity)}
                        <span className="text-sm">{entityLabels[log.entity] || log.entity}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      {renderChanges(log.action, log.entity, log.oldValue, log.newValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<FileText size={48} />}
            title="אין רשומות"
            description="לא נמצאו רשומות ביומן הפעילות"
          />
        )}
      </div>
    </>
  );
}
