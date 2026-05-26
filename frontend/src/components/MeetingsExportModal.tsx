import { useEffect, useState } from 'react';
import Modal from './ui/Modal';
import { Download } from 'lucide-react';

interface MeetingsExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (month?: string) => void;
  isExporting?: boolean;
  title?: string;
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

export default function MeetingsExportModal({
  isOpen,
  onClose,
  onExport,
  isExporting = false,
  title = 'ייצוא פגישות לאקסל',
}: MeetingsExportModalProps) {
  const [month, setMonth] = useState(currentMonth());
  const [allMonths, setAllMonths] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMonth(currentMonth());
      setAllMonths(false);
    }
  }, [isOpen]);

  const handleExport = () => {
    onExport(allMonths ? undefined : month);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="p-6 space-y-5" dir="rtl">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            בחר חודש לייצוא
          </label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={allMonths}
            className="form-input w-full text-right"
          />
          <p className="mt-2 text-sm text-gray-500">
            ייוצאו רק הפגישות ששייכות לחודש שנבחר.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={allMonths}
            onChange={(e) => setAllMonths(e.target.checked)}
            className="rounded border-gray-300"
          />
          ייצוא כל החודשים
        </label>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isExporting}>
            ביטול
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="btn btn-primary flex items-center gap-2"
            disabled={isExporting || (!allMonths && !month)}
          >
            <Download size={16} />
            {isExporting ? 'מייצא...' : 'ייצוא'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
