import { useRef, useState, useCallback } from 'react';
import { Upload, File, FileText, Image, Trash2, Download, Tag, Loader2, X } from 'lucide-react';
import {
  useFileAttachments,
  useUploadFile,
  useDeleteFile,
  useUpdateFileLabel,
  type FileAttachment,
} from '../hooks/useApi';

interface FileAttachmentsProps {
  entityType: 'instructor' | 'quote';
  entityId: string;
  canDelete?: boolean; // admin/manager can delete
  className?: string;
}

const LABEL_SUGGESTIONS = {
  instructor: ['חוזה', 'קורות חיים', 'תעודת זהות', 'תעודות הסמכה', 'אחר'],
  quote: ['הצעת מחיר חתומה', 'חוזה', 'אישור הזמנה', 'קבלה', 'אחר'],
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return <Image size={20} className="text-blue-500" />;
  if (mimeType === 'application/pdf') return <FileText size={20} className="text-red-500" />;
  return <File size={20} className="text-gray-500" />;
};

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });

export default function FileAttachments({ entityType, entityId, canDelete = false, className = '' }: FileAttachmentsProps) {
  const { data: files, isLoading } = useFileAttachments(entityType, entityId);
  const uploadFile = useUploadFile(entityType, entityId);
  const deleteFile = useDeleteFile(entityType, entityId);
  const updateLabel = useUpdateFileLabel(entityType, entityId);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadLabel, setUploadLabel] = useState('');
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleFiles = useCallback(async (fileList: FileList) => {
    const file = fileList[0];
    if (!file) return;
    try {
      await uploadFile.mutateAsync({ file, label: uploadLabel || undefined });
      setUploadLabel('');
    } catch (err: any) {
      alert(err?.response?.data?.message || 'שגיאה בהעלאת הקובץ');
    }
  }, [uploadFile, uploadLabel]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleDelete = async (id: string) => {
    try {
      await deleteFile.mutateAsync(id);
      setDeleteConfirmId(null);
    } catch (err: any) {
      alert(err?.response?.data?.message || 'שגיאה במחיקת הקובץ');
    }
  };

  const handleSaveLabel = async (id: string) => {
    try {
      await updateLabel.mutateAsync({ id, label: editingLabelValue });
      setEditingLabelId(null);
    } catch {
      // ignore
    }
  };

  const downloadUrl = (file: FileAttachment) => `/api/files/download/${file.id}`;

  const suggestions = LABEL_SUGGESTIONS[entityType];

  return (
    <div className={`space-y-4 ${className}`} dir="rtl">
      {/* Upload Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
          isDragging
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt,.zip,.rar"
        />
        {uploadFile.isPending ? (
          <div className="flex items-center justify-center gap-2 text-blue-600">
            <Loader2 size={24} className="animate-spin" />
            <span>מעלה קובץ...</span>
          </div>
        ) : (
          <>
            <Upload size={32} className="mx-auto mb-2 text-gray-400" />
            <p className="text-sm text-gray-600 font-medium">גרור קובץ לכאן או לחץ להעלאה</p>
            <p className="text-xs text-gray-400 mt-1">PDF, Word, Excel, תמונות — עד 20MB</p>
          </>
        )}
      </div>

      {/* Label input before upload */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            value={uploadLabel}
            onChange={(e) => setUploadLabel(e.target.value)}
            placeholder="תווית לקובץ (אופציונלי)"
            className="form-input w-full text-sm"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setUploadLabel(s)}
              className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                uploadLabel === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* File List */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-4 justify-center">
          <Loader2 size={16} className="animate-spin" />
          טוען קבצים...
        </div>
      ) : !files || files.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">אין קבצים מצורפים</p>
      ) : (
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="bg-white border border-gray-100 rounded-xl p-3 flex items-center gap-3 shadow-sm"
            >
              {/* Icon */}
              <div className="shrink-0">{getFileIcon(file.mimeType)}</div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate" title={file.originalName}>
                  {file.originalName}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {editingLabelId === file.id ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingLabelValue}
                        onChange={(e) => setEditingLabelValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveLabel(file.id); if (e.key === 'Escape') setEditingLabelId(null); }}
                        className="border border-blue-300 rounded px-2 py-0.5 text-xs w-32 focus:outline-none"
                        autoFocus
                      />
                      <button onClick={() => handleSaveLabel(file.id)} className="text-blue-600 text-xs">שמור</button>
                      <button onClick={() => setEditingLabelId(null)} className="text-gray-400"><X size={12} /></button>
                    </div>
                  ) : (
                    <>
                      {file.label && (
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                          {file.label}
                        </span>
                      )}
                      <button
                        onClick={() => { setEditingLabelId(file.id); setEditingLabelValue(file.label || ''); }}
                        className="text-gray-300 hover:text-gray-500 transition-colors"
                        title="ערוך תווית"
                      >
                        <Tag size={12} />
                      </button>
                    </>
                  )}
                  <span className="text-xs text-gray-400">{formatFileSize(file.fileSize)}</span>
                  <span className="text-xs text-gray-400">{formatDate(file.createdAt)}</span>
                  {file.uploadedBy && (
                    <span className="text-xs text-gray-400">↑ {file.uploadedBy.name}</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={downloadUrl(file)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-gray-400 hover:text-blue-600 transition-colors rounded-lg hover:bg-blue-50"
                  title="הורד"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download size={16} />
                </a>
                {canDelete && (
                  deleteConfirmId === file.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(file.id)}
                        disabled={deleteFile.isPending}
                        className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                      >
                        מחק
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
                      >
                        ביטול
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(file.id)}
                      className="p-2 text-gray-400 hover:text-red-600 transition-colors rounded-lg hover:bg-red-50"
                      title="מחק"
                    >
                      <Trash2 size={16} />
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
