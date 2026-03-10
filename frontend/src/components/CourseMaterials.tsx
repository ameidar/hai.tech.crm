/**
 * CourseMaterials Component
 * Displays Google Drive files for a course — usable in admin and instructor views
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { FolderOpen, FileText, Video, Music, ExternalLink, ChevronRight, ChevronLeft, Loader2, AlertCircle } from 'lucide-react';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  isFolder: boolean;
}

interface MaterialsResponse {
  files: DriveFile[];
  folderId: string | null;
  folderUrl: string | null;
  courseName: string;
}

interface BreadcrumbEntry {
  id: string;
  name: string;
}

interface CourseMaterialsProps {
  courseId: string;
  courseName?: string;
  compact?: boolean; // for instructor view
}

function getFileIcon(mimeType: string, isFolder: boolean) {
  if (isFolder) return <FolderOpen size={18} className="text-yellow-500" />;
  if (mimeType.includes('video')) return <Video size={18} className="text-blue-500" />;
  if (mimeType.includes('audio')) return <Music size={18} className="text-purple-500" />;
  return <FileText size={18} className="text-gray-500" />;
}

function getMimeLabel(mimeType: string): string {
  const map: Record<string, string> = {
    'application/vnd.google-apps.folder': '',
    'application/vnd.google-apps.document': 'מסמך',
    'application/vnd.google-apps.spreadsheet': 'גיליון',
    'application/vnd.google-apps.presentation': 'מצגת',
    'application/pdf': 'PDF',
    'video/mp4': 'וידאו',
    'audio/mpeg': 'אודיו',
    'audio/x-m4a': 'אודיו',
  };
  return map[mimeType] || '';
}

export function CourseMaterials({ courseId, courseName, compact = false }: CourseMaterialsProps) {
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([]);
  const currentFolder = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].id : undefined;

  const { data, isLoading, error } = useQuery<MaterialsResponse>({
    queryKey: ['course-materials', courseId, currentFolder],
    queryFn: () => {
      const url = `/courses/${courseId}/materials${currentFolder ? `?folder=${currentFolder}` : ''}`;
      return apiClient.get(url).then(r => r.data);
    },
    staleTime: 5 * 60 * 1000, // 5 min cache
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-4">
        <Loader2 size={16} className="animate-spin" />
        <span>טוען חומרי לימוד...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-500 py-4">
        <AlertCircle size={16} />
        <span>שגיאה בטעינת חומרים</span>
      </div>
    );
  }

  if (!data?.folderId) {
    return (
      <div className="text-gray-400 text-sm py-2">
        לא הוגדרו חומרי לימוד לקורס זה
      </div>
    );
  }

  const openFile = (file: DriveFile) => {
    if (file.isFolder) {
      setBreadcrumb(prev => [...prev, { id: file.id, name: file.name }]);
    } else {
      const url = file.webViewLink || `https://drive.google.com/open?id=${file.id}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const navigateBack = (index: number) => {
    setBreadcrumb(prev => prev.slice(0, index));
  };

  return (
    <div className={compact ? '' : 'border rounded-xl overflow-hidden'}>
      {/* Header */}
      {!compact && (
        <div className="bg-blue-50 border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen size={18} className="text-blue-600" />
            <span className="font-medium text-blue-800">📚 חומרי לימוד</span>
            {courseName && <span className="text-blue-600 text-sm">— {courseName}</span>}
          </div>
          {data.folderUrl && (
            <a
              href={data.folderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
            >
              פתח ב-Drive <ExternalLink size={12} />
            </a>
          )}
        </div>
      )}

      {/* Breadcrumb */}
      {breadcrumb.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-2 bg-gray-50 border-b text-sm text-gray-600 flex-wrap">
          <button
            onClick={() => setBreadcrumb([])}
            className="hover:text-blue-600 hover:underline"
          >
            {data.courseName || 'ראשי'}
          </button>
          {breadcrumb.map((b, i) => (
            <span key={b.id} className="flex items-center gap-1">
              <ChevronLeft size={14} />
              {i === breadcrumb.length - 1 ? (
                <span className="font-medium text-gray-800">{b.name}</span>
              ) : (
                <button
                  onClick={() => navigateBack(i + 1)}
                  className="hover:text-blue-600 hover:underline"
                >
                  {b.name}
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* File List */}
      <div className={compact ? 'space-y-1' : 'divide-y'}>
        {data.files.length === 0 && (
          <div className="text-gray-400 text-sm py-4 px-4">תיקייה ריקה</div>
        )}
        {data.files.map(file => (
          <div
            key={file.id}
            onClick={() => openFile(file)}
            className={`flex items-center gap-3 cursor-pointer transition-colors
              ${compact
                ? 'py-1.5 px-2 rounded hover:bg-gray-50'
                : 'px-4 py-3 hover:bg-blue-50'
              }`}
          >
            {getFileIcon(file.mimeType, file.isFolder)}
            <span className="flex-1 text-sm truncate">{file.name}</span>
            <span className="text-xs text-gray-400">{getMimeLabel(file.mimeType)}</span>
            {file.isFolder
              ? <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
              : <ExternalLink size={12} className="text-gray-400 flex-shrink-0" />
            }
          </div>
        ))}
      </div>
    </div>
  );
}
