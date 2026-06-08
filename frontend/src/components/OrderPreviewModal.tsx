import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, AlertOctagon, ShoppingCart, Loader2, ArrowLeft } from 'lucide-react';
import Modal from './ui/Modal';
import Loading from './ui/Loading';
import { quotesApi, type OrderPreview } from '../api/quotes';

interface OrderPreviewModalProps {
  quoteId: string;
  /** Pre-loaded preview (e.g. returned by the PDF import call). If omitted it is fetched. */
  initialPreview?: OrderPreview;
  /** Manual import path allows building an order from a not-yet-accepted quote. */
  allowNonAccepted?: boolean;
  onClose: () => void;
  onCreated: (orderId: string) => void;
}

const currency = (n: number) =>
  `₪${Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;

export default function OrderPreviewModal({
  quoteId,
  initialPreview,
  allowNonAccepted = false,
  onClose,
  onCreated,
}: OrderPreviewModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: fetched, isLoading } = useQuery({
    queryKey: ['order-preview', quoteId],
    queryFn: () => quotesApi.orderPreview(quoteId),
    enabled: !initialPreview,
  });

  const preview = initialPreview ?? fetched;

  const handleCreate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await quotesApi.convertToOrder(quoteId, allowNonAccepted);
      onCreated(result.order.id);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.response?.data?.error || 'יצירת ההזמנה נכשלה.');
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="תצוגה מקדימה — יצירת הזמנה מוסדית" size="lg">
      <div className="p-6 space-y-5" dir="rtl">
        {isLoading || !preview ? (
          <Loading size="md" text="טוען תצוגה מקדימה..." />
        ) : preview.existingOrderId ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4">
              <AlertOctagon className="text-amber-600 shrink-0 mt-0.5" size={20} />
              <p className="text-sm text-amber-800">
                הצעת מחיר {preview.quote.quoteNumber} כבר הומרה להזמנה קיימת.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="btn btn-secondary">סגור</button>
              <button onClick={() => onCreated(preview.existingOrderId!)} className="btn btn-primary">
                <ArrowLeft size={16} />
                עבור להזמנה הקיימת
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Flags */}
            {preview.flags.length > 0 && (
              <div className="space-y-2">
                {preview.flags.map((flag, i) => {
                  const isError = flag.level === 'error';
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                        isError
                          ? 'bg-red-50 border-red-200 text-red-800'
                          : 'bg-amber-50 border-amber-200 text-amber-800'
                      }`}
                    >
                      {isError ? (
                        <AlertOctagon className="shrink-0 mt-0.5" size={18} />
                      ) : (
                        <AlertTriangle className="shrink-0 mt-0.5" size={18} />
                      )}
                      <span>{flag.message}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Source quote */}
            <div className="text-sm text-gray-500">
              נבנה מהצעת מחיר{' '}
              <span className="font-semibold text-gray-700">{preview.quote.quoteNumber}</span>
            </div>

            {/* Order draft summary */}
            <div className="rounded-lg border border-gray-200 divide-y">
              <Row label="שם ההזמנה / מוסד" value={preview.orderDraft.orderName} />
              <Row label="סניף" value={preview.orderDraft.branchName || '— לא משויך —'} />
              <Row label="איש קשר" value={preview.orderDraft.contactName || '—'} />
              <Row
                label="טלפון / מייל"
                value={[preview.orderDraft.contactPhone, preview.orderDraft.contactEmail].filter(Boolean).join(' · ') || '—'}
              />
              <Row label="גוף משלם" value={preview.orderDraft.payingBody || '—'} />
              <Row label="מס׳ מפגשים מוערך" value={String(preview.orderDraft.estimatedMeetings)} />
              <Row label="מחיר ממוצע למפגש" value={currency(preview.orderDraft.pricePerMeeting)} />
              <Row label="סה״כ מוערך" value={currency(preview.orderDraft.estimatedTotal)} highlight />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="btn btn-secondary" disabled={submitting}>
                ביטול
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting || !preview.canCreate}
                className="btn btn-primary"
                title={!preview.canCreate ? 'יש לתקן את השגיאות המסומנות לפני יצירת ההזמנה' : undefined}
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <ShoppingCart size={16} />}
                צור הזמנה
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm ${highlight ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
        {value}
      </span>
    </div>
  );
}
