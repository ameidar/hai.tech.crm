import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Edit,
  Trash2,
  Send,
  CheckCircle,
  XCircle,
  ShoppingCart,
  FileText,
  Phone,
  Mail,
  User,
  Building2,
  Loader2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { quotesApi, type Quote } from '../api/quotes';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';

const statusHebrew: Record<string, string> = {
  draft: 'טיוטה',
  sent: 'נשלחה',
  accepted: 'אושרה',
  rejected: 'נדחתה',
};

const statusBadgeClass: Record<string, string> = {
  draft: 'badge-warning',
  sent: 'badge-info',
  accepted: 'badge-success',
  rejected: 'badge-danger',
};

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data: quote, isLoading } = useQuery({
    queryKey: ['quote', id],
    queryFn: () => quotesApi.get(id!),
    enabled: !!id,
  });

  const sendQuote = useMutation({
    mutationFn: () => quotesApi.send(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quote', id] }),
  });

  const acceptQuote = useMutation({
    mutationFn: () => quotesApi.accept(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quote', id] }),
  });

  const rejectQuote = useMutation({
    mutationFn: () => quotesApi.reject(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quote', id] }),
  });

  const convertToOrder = useMutation({
    mutationFn: () => quotesApi.convertToOrder(id!),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['quote', id] });
      alert('ההצעה הומרה להזמנה בהצלחה!');
    },
  });

  const deleteQuote = useMutation({
    mutationFn: () => quotesApi.delete(id!),
    onSuccess: () => navigate('/quotes'),
  });

  const handleDelete = async () => {
    try {
      await deleteQuote.mutateAsync();
    } catch (error) {
      console.error('Failed to delete quote:', error);
      alert('שגיאה במחיקת ההצעה');
    }
  };

  if (isLoading) {
    return <Loading size="lg" text="טוען פרטי הצעה..." />;
  }

  if (!quote) {
    return (
      <EmptyState
        title="הצעה לא נמצאה"
        description="ההצעה המבוקשת לא נמצאה במערכת"
        action={
          <Link to="/quotes" className="btn btn-primary">
            חזרה להצעות מחיר
          </Link>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={`הצעת מחיר #${quote.quoteNumber}`}
        actions={
          <div className="flex gap-2">
            {/* Actions based on status */}
            {quote.status === 'draft' && (
              <>
                <button
                  onClick={() => sendQuote.mutateAsync()}
                  disabled={sendQuote.isPending}
                  className="btn btn-primary"
                >
                  {sendQuote.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  שלח
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="btn btn-danger"
                >
                  <Trash2 size={16} />
                  מחק
                </button>
              </>
            )}
            {quote.status === 'sent' && (
              <>
                <button
                  onClick={() => acceptQuote.mutateAsync()}
                  disabled={acceptQuote.isPending}
                  className="btn btn-success"
                >
                  {acceptQuote.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                  אשר
                </button>
                <button
                  onClick={() => rejectQuote.mutateAsync()}
                  disabled={rejectQuote.isPending}
                  className="btn btn-danger"
                >
                  {rejectQuote.isPending ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                  דחה
                </button>
              </>
            )}
            {quote.status === 'accepted' && !quote.orderId && (
              <button
                onClick={() => convertToOrder.mutateAsync()}
                disabled={convertToOrder.isPending}
                className="btn btn-primary"
              >
                {convertToOrder.isPending ? <Loader2 size={16} className="animate-spin" /> : <ShoppingCart size={16} />}
                המר להזמנה
              </button>
            )}
            <Link to="/quotes" className="btn btn-secondary">
              <ArrowRight size={18} />
              חזרה
            </Link>
          </div>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quote Info */}
          <div className="space-y-6">
            {/* Details Card */}
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold">פרטי ההצעה</h2>
              </div>
              <div className="card-body space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <Building2 size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">מוסד</p>
                    <p className="font-medium">{quote.institutionName}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <User size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">איש קשר</p>
                    <p className="font-medium">{quote.contactName}</p>
                    {quote.contactRole && (
                      <p className="text-sm text-gray-400">{quote.contactRole}</p>
                    )}
                  </div>
                </div>

                {quote.contactPhone && (
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <Phone size={18} className="text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">טלפון</p>
                      <p className="font-medium" dir="ltr">{quote.contactPhone}</p>
                    </div>
                  </div>
                )}

                {quote.contactEmail && (
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <Mail size={18} className="text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">אימייל</p>
                      <p className="font-medium" dir="ltr">{quote.contactEmail}</p>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t flex items-center justify-between">
                  <span className={`badge ${statusBadgeClass[quote.status]}`}>
                    {statusHebrew[quote.status]}
                  </span>
                  <span className="text-sm text-gray-500">
                    {new Date(quote.createdAt).toLocaleDateString('he-IL')}
                  </span>
                </div>

                {quote.orderId && (
                  <div className="pt-3 border-t">
                    <Link
                      to={`/orders/${quote.orderId}`}
                      className="flex items-center gap-2 text-blue-600 hover:text-blue-800"
                    >
                      <ShoppingCart size={16} />
                      <span>צפה בהזמנה המקושרת</span>
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Financial Summary */}
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold">סיכום כספי</h2>
              </div>
              <div className="card-body space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">סה״כ לפני הנחה:</span>
                  <span className="font-medium">
                    ₪{((quote.totalAmount || 0) / (1 - (quote.discount || 0) / 100)).toLocaleString()}
                  </span>
                </div>
                {quote.discount > 0 && (
                  <div className="flex items-center justify-between text-red-600">
                    <span>הנחה ({quote.discount}%):</span>
                    <span>
                      -₪{(((quote.totalAmount || 0) / (1 - quote.discount / 100)) * quote.discount / 100).toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-lg font-bold border-t pt-3">
                  <span>סה״כ:</span>
                  <span className="text-green-600">₪{Number(quote.totalAmount || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Items & Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Items Table */}
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold">פריטים ({quote.items?.length || 0})</h2>
              </div>
              {quote.items && quote.items.length > 0 ? (
                <div className="overflow-x-auto">
                  <table>
                    <thead>
                      <tr>
                        <th>קורס</th>
                        <th>קבוצות</th>
                        <th>מפגשים</th>
                        <th>משך</th>
                        <th>מחיר למפגש</th>
                        <th>סה״כ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quote.items.map((item, index) => (
                        <tr key={item.id || index}>
                          <td className="font-medium">{item.courseName || '-'}</td>
                          <td>{item.groupsCount}</td>
                          <td>{item.meetingsPerGroup}</td>
                          <td>{item.durationMinutes} דקות</td>
                          <td>₪{Number(item.pricePerMeeting).toLocaleString()}</td>
                          <td className="font-semibold">₪{Number(item.subtotal).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-gray-500">
                  <FileText size={48} className="mx-auto mb-4 text-gray-300" />
                  <p>אין פריטים בהצעה</p>
                </div>
              )}
            </div>

            {/* Generated Content */}
            {quote.generatedContent && (
              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold">תוכן ההצעה</h2>
                </div>
                <div className="card-body">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed bg-gray-50 rounded-lg p-4">
                    {quote.generatedContent}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="מחיקת הצעה"
        size="sm"
      >
        <div className="p-6">
          <p className="text-gray-600 mb-6">
            האם למחוק את הצעת מחיר #{quote.quoteNumber}? פעולה זו לא ניתנת לביטול.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-secondary">
              ביטול
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteQuote.isPending}
              className="btn btn-danger"
            >
              {deleteQuote.isPending ? 'מוחק...' : 'מחק'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
