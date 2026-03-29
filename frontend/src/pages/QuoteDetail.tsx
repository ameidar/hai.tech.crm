import { useState, useEffect } from 'react';
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
  Eye,
  Copy,
  ExternalLink,
  Film,
  Download,
  Paperclip,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { quotesApi, type Quote } from '../api/quotes';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import FileAttachments from '../components/FileAttachments';

const statusHebrew: Record<string, string> = {
  draft: 'טיוטה',
  sent: 'נשלחה',
  accepted: 'אושרה',
  rejected: 'נדחתה',
  converted: 'הומרה להזמנה',
};

const statusBadgeClass: Record<string, string> = {
  draft: 'badge-warning',
  sent: 'badge-info',
  accepted: 'badge-success',
  rejected: 'badge-danger',
  converted: 'badge-success',
};

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [videoRendering, setVideoRendering] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [vimeoUrl, setVimeoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  const publicUrl = `${window.location.origin}/public/quote/${id}`;

  const copyPublicUrl = () => {
    navigator.clipboard.writeText(publicUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleGenerateVideo = async () => {
    if (!id) return;
    setVideoRendering(true);
    setVideoError(null);
    setVideoUrl(null);
    setVimeoUrl(null);
    try {
      await quotesApi.generateVideo(id);
      // Poll for video
      const poll = setInterval(async () => {
        try {
          const res = await quotesApi.getVideoStatus(id);
          if (res.status === 200 && res.data instanceof Blob) {
            // If JSON response (vimeo URL), parse it
            if (res.data.type === 'application/json') {
              const text = await res.data.text();
              const json = JSON.parse(text);
              if (json.vimeoUrl) {
                clearInterval(poll);
                setVimeoUrl(json.vimeoUrl);
                setVideoRendering(false);
                return;
              }
            }
            // Video blob
            if (res.data.type.startsWith('video/')) {
              clearInterval(poll);
              const url = URL.createObjectURL(res.data);
              setVideoUrl(url);
              setVideoRendering(false);
            }
          }
        } catch (err: any) {
          if (err?.response?.status === 500) {
            clearInterval(poll);
            setVideoError('שגיאה ביצירת הסרטון');
            setVideoRendering(false);
          }
          // 202 or 404 = still rendering, keep polling
        }
      }, 5000);
    } catch {
      setVideoError('שגיאה בהפעלת יצירת הסרטון');
      setVideoRendering(false);
    }
  };

  const { data: quote, isLoading } = useQuery({
    queryKey: ['quote', id],
    queryFn: () => quotesApi.get(id!),
    enabled: !!id,
  });

  // If quote has a persisted video, fetch it to determine type
  useEffect(() => {
    if (quote?.videoPath && id && !videoUrl && !vimeoUrl && !videoRendering) {
      if (quote.videoPath.startsWith('https://player.vimeo.com/')) {
        setVimeoUrl(quote.videoPath);
      } else {
        // Fetch the video endpoint to check if it returns Vimeo JSON or MP4
        fetch(`/api/quotes/${id}/video`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        }).then(async (res) => {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const json = await res.json();
            if (json.vimeoUrl) {
              setVimeoUrl(json.vimeoUrl);
              return;
            }
          }
          if (ct.startsWith('video/')) {
            const blob = await res.blob();
            setVideoUrl(URL.createObjectURL(blob));
          }
        }).catch(() => {});
      }
    }
  }, [quote?.videoPath, id]);

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
    onSuccess: () => {
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

  // Calculate financials from items
  const itemsTotal = (quote.items || []).reduce((sum: number, item: any) => sum + Number(item.subtotal || 0), 0);
  const discountValue = Number(quote.discount || 0);
  const finalAmount = Number(quote.finalAmount || quote.totalAmount || 0);

  return (
    <>
      <PageHeader
        title={`הצעת מחיר ${quote.quoteNumber}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {/* Preview - available for all statuses */}
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              <Eye size={16} />
              תצוגה מקדימה
            </a>

            {/* Edit - always available for draft/sent */}
            {(quote.status === 'draft' || quote.status === 'sent') && (
              <Link to={`/quotes/${id}/edit`} className="btn btn-secondary">
                <Edit size={16} />
                עריכה
              </Link>
            )}

            {/* Status actions */}
            {quote.status === 'draft' && (
              <>
                <button
                  onClick={() => {
                    if (quote.contactEmail) {
                      sendQuote.mutateAsync();
                    } else {
                      if (confirm('לא הוגדר מייל לאיש הקשר. ההצעה תסומן כנשלחה ללא שליחת מייל. להמשיך?')) {
                        sendQuote.mutateAsync();
                      }
                    }
                  }}
                  disabled={sendQuote.isPending}
                  className="btn btn-primary"
                >
                  {sendQuote.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  {quote.contactEmail ? 'שלח במייל' : 'סמן כנשלחה'}
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
            <button
              onClick={handleGenerateVideo}
              disabled={videoRendering}
              className="btn btn-secondary"
            >
              {videoRendering ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
              {videoRendering ? 'מייצר סרטון...' : 'צור סרטון שיווקי'}
            </button>
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
                  <span className={`badge ${statusBadgeClass[quote.status] || 'badge-info'}`}>
                    {statusHebrew[quote.status] || quote.status}
                  </span>
                  <span className="text-sm text-gray-500">
                    {new Date(quote.createdAt).toLocaleDateString('he-IL')}
                  </span>
                </div>

                {/* Public URL */}
                {(['sent', 'accepted', 'converted'] as string[]).includes(quote.status) && (
                  <div className="pt-3 border-t">
                    <p className="text-sm text-gray-500 mb-2">קישור ציבורי להצעה:</p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={publicUrl}
                        className="input text-xs flex-1"
                        dir="ltr"
                      />
                      <button onClick={copyPublicUrl} className="btn btn-secondary btn-sm" title="העתק">
                        {copiedUrl ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} />}
                      </button>
                      <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" title="פתח">
                        <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                )}

                {/* Linked order */}
                {quote.orderId && (
                  <div className="pt-3 border-t">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-sm text-green-700 font-medium mb-1">✅ הזמנה מקושרת</p>
                      <p className="text-xs text-green-600">
                        ההצעה הומרה להזמנה מוסדית
                      </p>
                      {/* TODO: link to order detail page when it exists */}
                    </div>
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
                  <span className="text-gray-500">סה״כ פריטים:</span>
                  <span className="font-medium">₪{itemsTotal.toLocaleString()}</span>
                </div>
                {discountValue > 0 && (
                  <div className="flex items-center justify-between text-red-600">
                    <span>הנחה:</span>
                    <span>-₪{discountValue.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-lg font-bold border-t pt-3">
                  <span>{(quote as any).includesVat ? 'סה״כ (כולל מע״מ):' : 'סה״כ (לא כולל מע״מ):'}</span>
                  <span className="text-green-600">₪{finalAmount.toLocaleString()}</span>
                </div>
                {!(quote as any).includesVat && (
                  <>
                    <div className="flex items-center justify-between text-sm text-gray-500">
                      <span>מע״מ (18%):</span>
                      <span>₪{Math.round(finalAmount * 0.18).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between font-medium">
                      <span>סה״כ כולל מע״מ:</span>
                      <span>₪{Math.round(finalAmount * 1.18).toLocaleString()}</span>
                    </div>
                  </>
                )}
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
                        <th>שם</th>
                        <th>פירוט</th>
                        <th>סה״כ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quote.items.map((item: any, index: number) => {
                        const isProject = item.groups === 1 && item.meetingsPerGroup === 1 && item.description;
                        return (
                          <tr key={item.id || index}>
                            <td className="font-medium">{item.courseName || '-'}</td>
                            <td className="text-sm text-gray-500">
                              {isProject
                                ? (item.description || 'מחיר כולל')
                                : `${item.groups} קבוצות × ${item.meetingsPerGroup} מפגשים × ₪${Number(item.pricePerMeeting).toLocaleString()}`
                              }
                            </td>
                            <td className="font-semibold">₪{Number(item.subtotal).toLocaleString()}</td>
                          </tr>
                        );
                      })}
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
            {(quote.generatedContent || quote.content) && (
              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold">תוכן ההצעה</h2>
                </div>
                <div className="card-body">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed bg-gray-50 rounded-lg p-4" dir="rtl">
                    {typeof quote.content === 'string' ? quote.content : (quote.content as any)?.markdown || quote.generatedContent || ''}
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            {quote.notes && (
              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold">הערות</h2>
                </div>
                <div className="card-body">
                  <p className="text-sm text-gray-600">{quote.notes}</p>
                </div>
              </div>
            )}

            {/* Terms */}
            {((quote as any).cancellationTerms || (quote as any).paymentTerms) && (
              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold">תנאים</h2>
                </div>
                <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(quote as any).paymentTerms && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">תנאי תשלום</p>
                      <p className="text-sm text-gray-700">{(quote as any).paymentTerms}</p>
                    </div>
                  )}
                  {(quote as any).cancellationTerms && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">תנאי ביטול</p>
                      <p className="text-sm text-gray-700">{(quote as any).cancellationTerms}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Video */}
            {(videoRendering || videoUrl || vimeoUrl || videoError || quote.videoPath) && (
              <div className="card">
                <div className="card-header">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Film size={18} />
                    סרטון שיווקי
                  </h2>
                </div>
                <div className="card-body">
                  {videoRendering && (
                    <div className="flex items-center gap-3 text-blue-600">
                      <Loader2 size={20} className="animate-spin" />
                      <span>מייצר סרטון ומעלה ל-Vimeo... (עד 2 דקות)</span>
                    </div>
                  )}
                  {videoError && (
                    <p className="text-red-500">{videoError}</p>
                  )}
                  {(vimeoUrl || (quote.videoPath && quote.videoPath.startsWith('https://player.vimeo.com/'))) && (
                    <div className="space-y-3">
                      <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
                        <iframe
                          src={vimeoUrl || quote.videoPath}
                          className="absolute inset-0 w-full h-full rounded-lg"
                          frameBorder="0"
                          allow="autoplay; fullscreen; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                      <div className="flex gap-2">
                        <a
                          href={(vimeoUrl || quote.videoPath || '').replace('player.vimeo.com/video', 'vimeo.com')}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary inline-flex items-center gap-2"
                        >
                          <ExternalLink size={16} />
                          פתח ב-Vimeo
                        </a>
                        <button
                          onClick={async () => {
                            if (!confirm('למחוק את הסרטון השיווקי? הפעולה תמחק גם מ-Vimeo.')) return;
                            try {
                              await quotesApi.deleteVideo(id!);
                              setVimeoUrl(null);
                              setVideoUrl(null);
                              queryClient.invalidateQueries({ queryKey: ['quote', id] });
                            } catch {
                              alert('שגיאה במחיקת הסרטון');
                            }
                          }}
                          className="btn btn-danger inline-flex items-center gap-2"
                        >
                          <Trash2 size={16} />
                          מחק סרטון
                        </button>
                      </div>
                    </div>
                  )}
                  {videoUrl && !vimeoUrl && (
                    <div className="space-y-3">
                      <video
                        src={videoUrl}
                        controls
                        className="w-full rounded-lg"
                        style={{ maxHeight: 400 }}
                      />
                      <div className="flex gap-2">
                        <a
                          href={videoUrl}
                          download={`quote-${quote.quoteNumber}-video.mp4`}
                          className="btn btn-secondary inline-flex items-center gap-2"
                        >
                          <Download size={16} />
                          הורד סרטון
                        </a>
                        <button
                          onClick={async () => {
                            if (!confirm('למחוק את הסרטון השיווקי?')) return;
                            try {
                              await quotesApi.deleteVideo(id!);
                              setVimeoUrl(null);
                              setVideoUrl(null);
                              queryClient.invalidateQueries({ queryKey: ['quote', id] });
                            } catch {
                              alert('שגיאה במחיקת הסרטון');
                            }
                          }}
                          className="btn btn-danger inline-flex items-center gap-2"
                        >
                          <Trash2 size={16} />
                          מחק סרטון
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* File Attachments */}
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold flex items-center gap-2">
                  <Paperclip size={18} />
                  קבצים מצורפים
                </h2>
              </div>
              <div className="card-body">
                <FileAttachments entityType="quote" entityId={quote.id} canDelete={true} />
              </div>
            </div>
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
            האם למחוק את הצעת מחיר {quote.quoteNumber}? פעולה זו לא ניתנת לביטול.
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
