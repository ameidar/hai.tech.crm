import { AlertTriangle, Trash2 } from 'lucide-react';
import Modal from './Modal';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  itemName?: string;
  warningText?: string;
  isLoading?: boolean;
}

export default function ConfirmDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'אישור מחיקה',
  itemName,
  warningText,
  isLoading = false,
}: ConfirmDeleteModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center shrink-0">
            <AlertTriangle size={20} className="text-red-600" />
          </div>
          <div>
            <p className="text-gray-800">
              האם אתה בטוח שברצונך למחוק
              {itemName ? <> את <span className="font-semibold">"{itemName}"</span>?</> : '?'}
            </p>
            {warningText && (
              <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠️ {warningText}
              </p>
            )}
            <p className="mt-2 text-sm text-gray-500">פעולה זו אינה ניתנת לביטול.</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isLoading}>
            ביטול
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn btn-danger flex items-center gap-2"
            disabled={isLoading}
          >
            <Trash2 size={16} />
            {isLoading ? 'מוחק...' : 'מחק'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
