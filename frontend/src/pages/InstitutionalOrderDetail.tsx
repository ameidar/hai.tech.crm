import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowRight,
  Edit,
  Trash2,
  Paperclip,
  Building2,
  Phone,
  Mail,
  User,
  Copy,
  Check,
  RefreshCcw,
  Calendar,
  Banknote,
} from 'lucide-react';
import {
  useInstitutionalOrderById,
  useUpdateInstitutionalOrder,
  useDeleteInstitutionalOrder,
  useBranches,
  usePayingBodies,
  type InstitutionalOrderData,
} from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal';
import FileAttachments from '../components/FileAttachments';
import OrderForm from '../components/OrderForm';

const statusLabels: Record<string, string> = {
  draft: 'טיוטה',
  active: 'פעיל',
  completed: 'הושלם',
  cancelled: 'בוטל',
};

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 border-gray-200',
  active: 'bg-green-100 text-green-700 border-green-200',
  completed: 'bg-blue-100 text-blue-700 border-blue-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
};

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('he-IL');
}

function formatCurrency(amount?: number | null) {
  if (amount == null) return '-';
  return `₪${Number(amount).toLocaleString('he-IL')}`;
}

const Field = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div>
    <div className="text-xs text-gray-400 mb-0.5">{label}</div>
    <div className="text-sm text-gray-800">{value || '-'}</div>
  </div>
);

export default function InstitutionalOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: order, isLoading } = useInstitutionalOrderById(id || null);
  const { data: branchesData } = useBranches();
  const branches = branchesData || [];
  const { data: payingBodiesData } = usePayingBodies();
  const payingBodies = payingBodiesData || [];

  const updateOrder = useUpdateInstitutionalOrder();
  const deleteOrder = useDeleteInstitutionalOrder();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [form, setForm] = useState<Partial<InstitutionalOrderData>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const populateForm = (o: any) => {
    setForm({
      branchId: o.branch?.id || '',
      orderName: o.orderName || '',
      orderNumber: o.orderNumber || '',
      startDate: o.startDate?.slice(0, 10) || '',
      endDate: o.endDate?.slice(0, 10) || '',
      pricePerMeeting: o.pricePerMeeting,
      estimatedMeetings: o.estimatedMeetings,
      contactName: o.contactName || '',
      contactPhone: o.contactPhone || '',
      contactEmail: o.contactEmail || '',
      status: o.status,
      fireberryStatus: o.fireberryStatus || '',
      notes: o.notes || '',
      totalAmount: o.totalAmount,
      payingBody: o.payingBody || '',
      payingBodyId: o.payingBodyRef?.id || o.payingBodyId || '',
      taxId: o.taxId || '',
      paymentTermsDays: o.paymentTermsDays ?? 30,
      followUpDate: o.followUpDate?.slice(0, 10) || '',
      salesperson: o.salesperson || '',
      orderType: o.orderType || '',
      createdBy: o.createdBy || '',
    });
  };

  const openEdit = () => {
    if (!order) return;
    populateForm(order);
    setFormError(null);
    setIsEditOpen(true);
  };

  const handleSubmit = async () => {
    if (!id) return;
    setFormError(null);
    try {
      await updateOrder.mutateAsync({ id, data: form as InstitutionalOrderData });
      setIsEditOpen(false);
    } catch (e: any) {
      setFormError(e?.response?.data?.message || e?.response?.data?.error || 'שמירת ההזמנה נכשלה.');
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteOrder.mutateAsync(id);
      navigate('/institutional-orders');
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    setCopied(false);
  }, [id]);

  if (isLoading) return <Loading />;
  if (!order) {
    return (
      <EmptyState
        icon={<Building2 size={40} />}
        title="הזמנה לא נמצאה"
        description="ההזמנה המבוקשת אינה קיימת או נמחקה."
        action={<Link to="/institutional-orders" className="btn btn-primary">חזרה להזמנות</Link>}
      />
    );
  }

  const branchOptions = branches.map((b: any) => ({ value: b.id, label: b.name }));
  const payingBodyOptions = payingBodies.map((p: any) => ({
    value: p.id,
    label: p.taxId ? `${p.name} · ${p.taxId}` : p.name,
  }));

  const payingBodyName = order.payingBodyRef?.name || order.payingBody;

  return (
    <>
      <PageHeader
        title={order.orderName || order.orderNumber || 'הזמנה מוסדית'}
        subtitle={order.branch?.name}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/institutional-orders')} className="btn btn-secondary flex items-center gap-2">
              <ArrowRight size={16} />
              חזרה
            </button>
            <button onClick={handleCopyLink} className="btn btn-secondary flex items-center gap-2" title="העתק קישור לשיתוף">
              {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
              {copied ? 'הועתק' : 'העתק קישור'}
            </button>
            <button onClick={openEdit} className="btn btn-primary flex items-center gap-2">
              <Edit size={16} />
              ערוך
            </button>
            <button onClick={() => setShowDelete(true)} className="btn btn-danger flex items-center gap-2">
              <Trash2 size={16} />
              מחק
            </button>
          </div>
        }
      />

      <div className="p-6 space-y-6" dir="rtl">
        {/* Status */}
        <div className="flex items-center gap-2 flex-wrap">
          {order.fireberryStatus && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
              {order.fireberryStatus}
            </span>
          )}
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusColors[order.status] || ''}`}>
            {statusLabels[order.status] || order.status}
          </span>
          {order.orderNumber && <span className="text-xs text-gray-400">#{order.orderNumber}</span>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Order details */}
          <div className="card lg:col-span-2">
            <div className="card-header">
              <h2 className="font-semibold flex items-center gap-2"><Building2 size={18} />פרטי ההזמנה</h2>
            </div>
            <div className="card-body grid grid-cols-2 md:grid-cols-3 gap-4">
              <Field label="שם ההזמנה" value={order.orderName} />
              <Field label="סניף" value={order.branch?.name} />
              <Field label="גוף משלם" value={payingBodyName} />
              <Field label="ח.פ / ת.ז" value={order.taxId} />
              <Field label="סוג הזמנה" value={order.orderType} />
              <Field label="מבצע" value={order.salesperson} />
              <Field label="נוצר על ידי" value={order.createdBy} />
              <Field label="תאריך פולואפ" value={formatDate(order.followUpDate)} />
              <Field label="תנאי תשלום" value={order.paymentTermsDays != null ? `שוטף + ${order.paymentTermsDays}` : '-'} />
            </div>
          </div>

          {/* Financials */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold flex items-center gap-2"><Banknote size={18} />כספים</h2>
            </div>
            <div className="card-body space-y-3">
              <Field label="סה״כ משוער" value={<span className="font-semibold text-green-600">{formatCurrency(order.estimatedTotal ?? order.totalAmount)}</span>} />
              <Field label="תשלום כולל" value={formatCurrency(order.totalAmount)} />
              <Field label="מחיר לפגישה" value={formatCurrency(order.pricePerMeeting)} />
              <Field label="פגישות משוערות" value={order.estimatedMeetings} />
            </div>
          </div>

          {/* Contact */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold flex items-center gap-2"><User size={18} />איש קשר</h2>
            </div>
            <div className="card-body space-y-3">
              <Field label="שם" value={order.contactName} />
              <Field label="טלפון" value={order.contactPhone ? <span dir="ltr" className="inline-flex items-center gap-1"><Phone size={13} className="text-gray-400" />{order.contactPhone}</span> : '-'} />
              <Field label="מייל" value={order.contactEmail ? <span dir="ltr" className="inline-flex items-center gap-1"><Mail size={13} className="text-gray-400" />{order.contactEmail}</span> : '-'} />
            </div>
          </div>

          {/* Dates / cycles */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold flex items-center gap-2"><Calendar size={18} />תאריכים</h2>
            </div>
            <div className="card-body space-y-3">
              <Field label="תאריך התחלה" value={formatDate(order.startDate)} />
              <Field label="תאריך סיום" value={formatDate(order.endDate)} />
              <Field label="מחזורים מקושרים" value={order._count?.cycles != null ? <span className="inline-flex items-center gap-1"><RefreshCcw size={13} className="text-gray-400" />{order._count.cycles}</span> : '-'} />
            </div>
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="card lg:col-span-3">
              <div className="card-header">
                <h2 className="font-semibold">הערות / תיאור</h2>
              </div>
              <div className="card-body">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{order.notes}</p>
              </div>
            </div>
          )}

          {/* File Attachments */}
          <div className="card lg:col-span-3">
            <div className="card-header">
              <h2 className="font-semibold flex items-center gap-2"><Paperclip size={18} />מסמכים מצורפים</h2>
            </div>
            <div className="card-body">
              <FileAttachments entityType="institutional-order" entityId={order.id} canDelete={true} />
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="עריכת הזמנה מוסדית">
        <OrderForm
          form={form}
          setForm={setForm}
          isEdit={true}
          branchOptions={branchOptions}
          payingBodyOptions={payingBodyOptions}
          formError={formError}
          saving={updateOrder.isPending}
          onSubmit={handleSubmit}
          onCancel={() => { setIsEditOpen(false); setFormError(null); }}
        />
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDeleteModal
        isOpen={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        itemName={order.orderName || order.branch?.name || order.orderNumber}
        warningText={order._count?.cycles ? `להזמנה יש ${order._count.cycles} מחזורים מקושרים` : undefined}
        isLoading={deleteOrder.isPending}
      />
    </>
  );
}
