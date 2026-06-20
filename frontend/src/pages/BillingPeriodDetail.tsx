import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight, Plus, Trash2, Eye, Send, AlertCircle, CheckCircle2, ExternalLink, X, MessageCircle, Wallet, FileCheck2, Unlock } from 'lucide-react';
import { api } from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import { useAuth } from '../context/AuthContext';

interface Line {
  id: string;
  cycleId: string | null;
  description: string;
  descriptionCustomized: boolean;
  studentCount?: number | null;
  quantity: string | number;
  unitPrice: string | number;
  total: string | number;
  sortOrder: number;
  cycle?: { revenueIncludesVat: boolean | null } | null;
}

interface Payment {
  id: string;
  amount: string | number;
  method: string | null;
  notes: string | null;
  paidAt: string;
  recordedById: string | null;
  morningReceiptId?: string | null;
  morningReceiptNumber?: number | null;
  morningReceiptUrl?: string | null;
}

interface Period {
  id: string;
  monthStart: string;
  monthEnd: string;
  status: 'draft' | 'issued' | 'cancelled';
  totalAmount: string | number;
  documentTitle: string | null;
  notes: string | null;
  sendByEmail: boolean;
  morningDocNumber: number | null;
  morningDocUrl: string | null;
  morningDocId: string | null;
  issuedAt: string | null;
  dueDate: string | null;
  taxInvoiceId: string | null;
  taxInvoiceNumber: number | null;
  taxInvoiceUrl: string | null;
  taxInvoiceIssuedAt: string | null;
  taxInvoiceType: number | null;
  proformaSource: string | null;
  sentAt: string | null;
  sentChannel: string | null;
  sentToEmail: string | null;
  sentToPhone: string | null;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  paidAmount: string | number;
  paidAt: string | null;
  institutionalOrder: {
    id: string;
    orderName: string | null;
    taxId: string | null;
    contactEmail: string | null;
    contactName: string | null;
    contactPhone?: string | null;
    address: string | null;
    city: string | null;
    branch?: { name: string | null };
    payingBodyRef?: {
      id: string;
      name: string;
      taxId: string | null;
      contactName: string | null;
      email: string | null;
      phone: string | null;
      address: string | null;
      city: string | null;
    } | null;
  };
  lines: Line[];
  payments: Payment[];
  _count?: { meetings: number };
}

interface DriftMeeting {
  id: string;
  scheduledDate: string;
  startTime: string;
  revenue: string | number;
  instructorPayment: string | number;
  cycle: { id: string; name: string; type: string };
  instructor: { id: string; name: string };
}

interface DriftReport {
  issuedAt: string | null;
  snapshotCount: number;
  currentCount: number;
  newSinceIssue: DriftMeeting[];
  removedSinceIssue: string[];
}

const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Morning payment-line types (for receipt documents like 320)
const PAYMENT_TYPE_OPTIONS = [
  { value: 1, label: 'מזומן' },
  { value: 2, label: 'צ׳ק' },
  { value: 3, label: 'כרטיס אשראי' },
  { value: 4, label: 'העברה בנקאית' },
  { value: 5, label: 'PayPal' },
  { value: 10, label: 'אפליקציית תשלום (ביט)' },
  { value: 0, label: 'ניכוי מס במקור' },
];

// Best-effort map a free-text payment method to a Morning payment type — mirrors the backend.
function methodToMorningType(method?: string | null): number {
  const m = (method || '').toLowerCase();
  if (/מזומן|cash/.test(m)) return 1;
  if (/צ['׳]?ק|שיק|check|cheque/.test(m)) return 2;
  if (/אשראי|כרטיס|credit|card/.test(m)) return 3;
  if (/העברה|בנק|transfer|wire|bank/.test(m)) return 4;
  if (/paypal|פייפל/.test(m)) return 5;
  if (/ביט|bit|פייבוקס|paybox|app/.test(m)) return 10;
  return 4;
}

function formatCurrency(amount: number) {
  return amount.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' });
}

function billingTotals(lines: Line[], fallbackTotal: string | number) {
  const hasLines = lines.length > 0;
  const vatIncluded = lines.filter((line) => line.cycle?.revenueIncludesVat === true)
    .reduce((sum, line) => sum + Number(line.total || 0), 0);
  const vatExcluded = lines.filter((line) => line.cycle?.revenueIncludesVat !== true)
    .reduce((sum, line) => sum + Number(line.total || 0), 0);
  const base = hasLines ? vatIncluded + vatExcluded : Number(fallbackTotal || 0);
  const vatToAdd = vatExcluded * 0.18;
  const totalDue = hasLines ? vatIncluded + vatExcluded + vatToAdd : Number(fallbackTotal || 0) * 1.18;
  const allVatIncluded = hasLines && vatExcluded === 0;
  const allVatExcluded = hasLines && vatIncluded === 0;
  return { vatIncluded, vatExcluded, base, vatToAdd, totalDue, allVatIncluded, allVatExcluded };
}

function rangeLabel(startIso: string, endIso: string) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sm = HEBREW_MONTHS[s.getUTCMonth()], sy = s.getUTCFullYear();
  const em = HEBREW_MONTHS[e.getUTCMonth()], ey = e.getUTCFullYear();
  if (sy === ey && s.getUTCMonth() === e.getUTCMonth()) return `${sm} ${sy}`;
  if (sy === ey) return `${sm}–${em} ${sy}`;
  return `${sm} ${sy} – ${em} ${ey}`;
}

export default function BillingPeriodDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'operations';
  const [period, setPeriod] = useState<Period | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Document date for the חשבון עסקה (proforma). Defaults to today; can be backdated.
  const [docDate, setDocDate] = useState<string>(new Date().toISOString().slice(0, 10));

  // Inline editor state for new line
  const [newLine, setNewLine] = useState({ description: '', quantity: '1', unitPrice: '0' });
  const [showAddLine, setShowAddLine] = useState(false);

  // Payment + actions state
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [newPayment, setNewPayment] = useState({ amount: '', method: '', notes: '', paidAt: new Date().toISOString().slice(0, 10) });
  const [showWhatsAppForm, setShowWhatsAppForm] = useState(false);
  const [waPhone, setWaPhone] = useState('');
  const [waMessage, setWaMessage] = useState('');

  // Tax invoice + receipt (320) modal state
  const [showTaxModal, setShowTaxModal] = useState(false);
  const [taxMode, setTaxMode] = useState<'320' | '305'>('320'); // 320 = invoice+receipt (default), 305 = invoice only
  const [taxPayments, setTaxPayments] = useState<{ date: string; type: number; amount: string; chequeNum?: string; bankName?: string; bankBranch?: string; bankAccount?: string }[]>([]);
  const [taxDocDate, setTaxDocDate] = useState<string>('');
  const [taxBusy, setTaxBusy] = useState(false);

  // Standalone receipt (400) modal — only for periods whose tax invoice is a standalone 305.
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptForm, setReceiptForm] = useState({ amount: '', method: 'העברה בנקאית', documentDate: new Date().toISOString().slice(0, 10) });
  const [receiptBusy, setReceiptBusy] = useState(false);

  // Link an externally-issued Morning proforma (חשבון עסקה) to a draft period.
  const [showExternalModal, setShowExternalModal] = useState(false);
  const [externalForm, setExternalForm] = useState({ url: '', documentNumber: '', documentId: '', issuedAt: '' });
  const [externalBusy, setExternalBusy] = useState(false);

  // Link an externally-issued Morning receipt (קבלה) to a 305 tax invoice — records the payment
  // without creating a new Morning document (the receipt already exists there).
  const [showLinkReceiptModal, setShowLinkReceiptModal] = useState(false);
  const [linkReceiptForm, setLinkReceiptForm] = useState({ amount: '', method: 'העברה בנקאית', paidAt: new Date().toISOString().slice(0, 10), url: '', documentNumber: '' });
  const [linkReceiptBusy, setLinkReceiptBusy] = useState(false);

  // Link an externally-issued Morning tax invoice (305 or 320) — sets tax invoice fields
  // without creating a new Morning document. For 320 also closes the period as fully paid.
  const [showLinkTaxModal, setShowLinkTaxModal] = useState(false);
  const [linkTaxForm, setLinkTaxForm] = useState({ documentType: '320' as '305' | '320', documentNumber: '', url: '', issuedAt: new Date().toISOString().slice(0, 10) });
  const [linkTaxBusy, setLinkTaxBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/billing/${id}`);
      setPeriod(data);
      if (data.status === 'issued') {
        try {
          const { data: d } = await api.get(`/billing/${id}/drift`);
          setDrift(d);
        } catch { setDrift(null); }
      } else {
        setDrift(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  function handleErr(err: any) {
    const msg = err.response?.data?.details?.errorMessage
      || err.response?.data?.error
      || err.message
      || 'שגיאה';
    setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  async function updateLine(lineId: string, patch: Partial<Pick<Line, 'description' | 'quantity' | 'unitPrice'>>) {
    setError(null);
    try {
      await api.put(`/billing/${id}/lines/${lineId}`, {
        ...patch,
        ...(patch.quantity !== undefined && { quantity: Number(patch.quantity) }),
        ...(patch.unitPrice !== undefined && { unitPrice: Number(patch.unitPrice) }),
      });
      await load();
    } catch (err) { handleErr(err); }
  }

  async function deleteLine(lineId: string) {
    if (!confirm('למחוק את השורה?')) return;
    setError(null);
    try {
      await api.delete(`/billing/${id}/lines/${lineId}`);
      await load();
    } catch (err) { handleErr(err); }
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/billing/${id}/lines`, {
        description: newLine.description,
        quantity: Number(newLine.quantity),
        unitPrice: Number(newLine.unitPrice),
      });
      setNewLine({ description: '', quantity: '1', unitPrice: '0' });
      setShowAddLine(false);
      await load();
    } catch (err) { handleErr(err); }
  }

  async function updateNotesAndEmail(patch: { documentTitle?: string; notes?: string; sendByEmail?: boolean }) {
    setError(null);
    try {
      await api.put(`/billing/${id}`, patch);
      await load();
    } catch (err) { handleErr(err); }
  }

  async function preview() {
    setError(null);
    setBusy(true);
    try {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const { data } = await api.post(`/billing/${id}/preview`, { documentDate: docDate || undefined });
      const binary = atob(data.fileBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      window.open(url, '_blank');
    } catch (err) { handleErr(err); } finally { setBusy(false); }
  }

  async function issue() {
    if (!confirm('להפיק חשבון עסקה אמיתי במורנינג? אי אפשר לבטל מסמך שהופק (רק לסגור ב-UI).')) return;
    setError(null);
    setBusy(true);
    try {
      await api.post(`/billing/${id}/issue`, { documentDate: docDate || undefined });
      await load();
    } catch (err) { handleErr(err); } finally { setBusy(false); }
  }

  async function cancelDraft() {
    if (!confirm('לבטל את ה-draft? לא ייווצר רישום במורנינג.')) return;
    setError(null);
    try {
      await api.post(`/billing/${id}/cancel`);
      await load();
    } catch (err) { handleErr(err); }
  }

  async function unlockIssued() {
    const reason = prompt(
      'ביטול נעילה של חיוב חודשי שכבר הופק במורנינג.\n\n' +
      '⚠️ הסטטוס במערכת ישתנה ל"בוטלה" וניתן יהיה להוסיף/למחוק פגישות בחודש הזה — אבל החשבונית במורנינג נשארת בתוקף וצריך לטפל בה ידנית.\n\n' +
      'הודעת מייל תישלח ל-info@hai.tech עם פרטי הפעולה.\n\n' +
      'אנא ציין סיבה לביטול הנעילה:'
    );
    if (!reason || !reason.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api.post(`/billing/${id}/unlock`, { reason: reason.trim() });
      await load();
    } catch (err) { handleErr(err); } finally { setBusy(false); }
  }

  async function regenerate() {
    if (!period) return;
    if (!confirm('לרענן מתוך הפגישות? סכומי הכמות/מחיר/סה״כ ירעננו; תיאורים שעברו עריכה ידנית יישמרו.')) return;
    setError(null);
    setBusy(true);
    try {
      const monthStart = period.monthStart.slice(0, 7); // YYYY-MM
      const monthEnd = period.monthEnd.slice(0, 7);
      await api.post('/billing/generate', {
        institutionalOrderId: period.institutionalOrder.id,
        monthStart,
        monthEnd,
      });
      await load();
    } catch (err) { handleErr(err); } finally { setBusy(false); }
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/billing/${id}/payments`, {
        amount: Number(newPayment.amount),
        method: newPayment.method || null,
        notes: newPayment.notes || null,
        paidAt: newPayment.paidAt || null,
      });
      setNewPayment({ amount: '', method: '', notes: '', paidAt: new Date().toISOString().slice(0, 10) });
      setShowPaymentForm(false);
      await load();
    } catch (err) { handleErr(err); } finally { setBusy(false); }
  }

  async function deletePayment(paymentId: string) {
    if (!confirm('למחוק את רישום התשלום?')) return;
    setError(null);
    try {
      await api.delete(`/billing/${id}/payments/${paymentId}`);
      await load();
    } catch (err) { handleErr(err); }
  }

  async function markSent(channel: 'manual' | 'email') {
    setError(null);
    try {
      await api.post(`/billing/${id}/mark-sent`, {
        channel,
        toEmail: channel === 'email' ? period?.institutionalOrder.contactEmail || null : null,
      });
      await load();
    } catch (err) { handleErr(err); }
  }

  async function openWhatsApp() {
    if (!period) return;
    const phone = period.institutionalOrder.contactPhone || '';
    setWaPhone(phone);
    const orderName = period.institutionalOrder.orderName || 'מוסד';
    const monthLbl = rangeLabel(period.monthStart, period.monthEnd);
    const totalGross = billingTotals(period.lines, period.totalAmount).totalDue.toFixed(2);
    setWaMessage([
      `שלום,`,
      `מצורף חשבון עסקה מספר ${period.morningDocNumber} עבור ${orderName} — ${monthLbl}.`,
      `סכום לתשלום: ₪${totalGross} (כולל מע"מ).`,
      `קישור למסמך: ${period.morningDocUrl}`,
      ``,
      `דרך ההיי-טק בע"מ`,
    ].join('\n'));
    setShowWhatsAppForm(true);
  }

  async function sendWhatsApp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/billing/${id}/send-whatsapp`, {
        phone: waPhone,
        message: waMessage,
      });
      setShowWhatsAppForm(false);
      await load();
    } catch (err) { handleErr(err); } finally { setBusy(false); }
  }

  function openTaxModal() {
    if (!period) return;
    const rows = period.payments.length > 0
      ? period.payments.map((p) => ({
          date: new Date(p.paidAt).toISOString().slice(0, 10),
          type: methodToMorningType(p.method),
          amount: String(Number(p.amount)),
        }))
      : [{
          date: new Date().toISOString().slice(0, 10),
          type: 4,
          amount: billingTotals(period.lines, period.totalAmount).totalDue.toFixed(2),
        }];
    setTaxPayments(rows);
    setTaxMode('320');
    // Default the invoice date to the earliest cheque/payment date, so the document
    // carries the date written on the cheque rather than today's date.
    setTaxDocDate(rows.map((r) => r.date).sort()[0] || new Date().toISOString().slice(0, 10));
    setError(null);
    setShowTaxModal(true);
  }

  function updateTaxRow(i: number, patch: Partial<{ date: string; type: number; amount: string; chequeNum: string; bankName: string; bankBranch: string; bankAccount: string }>) {
    setTaxPayments((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addTaxRow() {
    setTaxPayments((rows) => [...rows, { date: new Date().toISOString().slice(0, 10), type: 4, amount: '' }]);
  }
  function removeTaxRow(i: number) {
    setTaxPayments((rows) => rows.filter((_, idx) => idx !== i));
  }
  function taxPaymentsPayload() {
    return taxPayments
      .filter((r) => Number(r.amount) > 0)
      .map((r) => {
        const base = { date: r.date, type: r.type, amount: Number(r.amount) };
        if (r.type !== 2) return base; // cheque details only for type 2 (צ׳ק)
        return {
          ...base,
          ...(r.chequeNum?.trim() ? { chequeNum: r.chequeNum.trim() } : {}),
          ...(r.bankName?.trim() ? { bankName: r.bankName.trim() } : {}),
          ...(r.bankBranch?.trim() ? { bankBranch: r.bankBranch.trim() } : {}),
          ...(r.bankAccount?.trim() ? { bankAccount: r.bankAccount.trim() } : {}),
        };
      });
  }

  async function previewTaxInvoice() {
    setError(null);
    setTaxBusy(true);
    try {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const { data } = await api.post(`/billing/${id}/preview-tax-invoice`, { payments: taxPaymentsPayload(), documentDate: taxDocDate || undefined });
      const binary = atob(data.fileBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      window.open(url, '_blank');
    } catch (err) { handleErr(err); } finally { setTaxBusy(false); }
  }

  async function confirmIssueTaxInvoice() {
    const msg = taxMode === '305'
      ? 'להפיק חשבונית מס בלבד (305) במורנינג? המסמך מחייב ולא ניתן לביטול. את הקבלות תפיק בנפרד לאחר קבלת התשלום.'
      : 'להפיק חשבונית מס/קבלה מחייבת (320) במורנינג? המסמך לא ניתן לביטול.';
    if (!confirm(msg)) return;
    setError(null);
    setTaxBusy(true);
    try {
      if (taxMode === '305') {
        await api.post(`/billing/${id}/issue-tax-invoice-only`, { documentDate: taxDocDate || undefined });
      } else {
        await api.post(`/billing/${id}/issue-tax-invoice`, { payments: taxPaymentsPayload(), documentDate: taxDocDate || undefined });
      }
      setShowTaxModal(false);
      await load();
    } catch (err) { handleErr(err); } finally { setTaxBusy(false); }
  }

  function openReceiptModal() {
    if (!period) return;
    const balance = billingTotals(period.lines, period.totalAmount).totalDue - Number(period.paidAmount);
    setReceiptForm({
      amount: balance > 0 ? balance.toFixed(2) : '',
      method: 'העברה בנקאית',
      documentDate: new Date().toISOString().slice(0, 10),
    });
    setError(null);
    setShowReceiptModal(true);
  }

  async function confirmIssueReceipt() {
    const amount = Number(receiptForm.amount);
    if (!(amount > 0)) { setError('יש להזין סכום קבלה חיובי'); return; }
    if (!confirm(`להפיק קבלה (400) על סך ${formatCurrency(amount)} במורנינג? המסמך מחייב ולא ניתן לביטול.`)) return;
    setError(null);
    setReceiptBusy(true);
    try {
      await api.post(`/billing/${id}/issue-receipt`, {
        amount,
        method: receiptForm.method || undefined,
        documentDate: receiptForm.documentDate || undefined,
        paidAt: receiptForm.documentDate || undefined,
      });
      setShowReceiptModal(false);
      await load();
    } catch (err) { handleErr(err); } finally { setReceiptBusy(false); }
  }

  function openLinkReceiptModal() {
    if (!period) return;
    const balance = billingTotals(period.lines, period.totalAmount).totalDue - Number(period.paidAmount);
    setLinkReceiptForm({
      amount: balance > 0 ? balance.toFixed(2) : '',
      method: 'העברה בנקאית',
      paidAt: new Date().toISOString().slice(0, 10),
      url: '',
      documentNumber: '',
    });
    setError(null);
    setShowLinkReceiptModal(true);
  }

  async function submitLinkReceipt() {
    const amount = Number(linkReceiptForm.amount);
    if (!(amount > 0)) { setError('יש להזין סכום קבלה חיובי'); return; }
    if (!linkReceiptForm.url && !linkReceiptForm.documentNumber) {
      setError('יש להזין מספר קבלה או קישור למסמך במורנינג');
      return;
    }
    setError(null);
    setLinkReceiptBusy(true);
    try {
      await api.post(`/billing/${id}/link-external-receipt`, {
        amount,
        method: linkReceiptForm.method || undefined,
        paidAt: linkReceiptForm.paidAt || undefined,
        url: linkReceiptForm.url || undefined,
        documentNumber: linkReceiptForm.documentNumber ? Number(linkReceiptForm.documentNumber) : undefined,
      });
      setShowLinkReceiptModal(false);
      await load();
    } catch (err) { handleErr(err); } finally { setLinkReceiptBusy(false); }
  }

  function openLinkTaxModal() {
    setLinkTaxForm({ documentType: '320', documentNumber: '', url: '', issuedAt: new Date().toISOString().slice(0, 10) });
    setError(null);
    setShowLinkTaxModal(true);
  }

  async function submitLinkTax() {
    if (!linkTaxForm.documentNumber && !linkTaxForm.url) {
      setError('יש להזין מספר מסמך או קישור');
      return;
    }
    setError(null);
    setLinkTaxBusy(true);
    try {
      await api.post(`/billing/${id}/link-external-tax-invoice`, {
        documentType: Number(linkTaxForm.documentType),
        documentNumber: linkTaxForm.documentNumber ? Number(linkTaxForm.documentNumber) : undefined,
        url: linkTaxForm.url || undefined,
        issuedAt: linkTaxForm.issuedAt || undefined,
      });
      setShowLinkTaxModal(false);
      await load();
    } catch (err) { handleErr(err); } finally { setLinkTaxBusy(false); }
  }

  async function submitExternalProforma() {
    if (!externalForm.url && !externalForm.documentNumber && !externalForm.documentId) {
      setError('יש להזין לפחות קישור, מספר מסמך או מזהה מסמך');
      return;
    }
    setError(null);
    setExternalBusy(true);
    try {
      await api.post(`/billing/${id}/link-external-proforma`, {
        url: externalForm.url || undefined,
        documentNumber: externalForm.documentNumber ? Number(externalForm.documentNumber) : undefined,
        documentId: externalForm.documentId || undefined,
        issuedAt: externalForm.issuedAt || undefined,
      });
      setShowExternalModal(false);
      await load();
    } catch (err) { handleErr(err); } finally { setExternalBusy(false); }
  }

  if (loading) return <div className="p-6 text-center text-gray-500">טוען...</div>;
  if (!period) return <div className="p-6 text-center text-red-600">{error || 'לא נמצא'}</div>;

  const isDraft = period.status === 'draft';
  const order = period.institutionalOrder;
  const payer = order.payingBodyRef ?? null;
  const missingTaxId = !!payer && !payer.taxId;
  const totals = billingTotals(period.lines, period.totalAmount);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <Link to="/billing" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowRight size={14} /> חזור לרשימה
      </Link>

      <PageHeader
        title={`חשבון חודשי — ${order.orderName || 'מוסד'}`}
        subtitle={`${rangeLabel(period.monthStart, period.monthEnd)} · סטטוס: ${period.status === 'draft' ? 'טיוטה' : period.status === 'issued' ? 'הופק' : 'בוטלה'}`}
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" /> <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {period.status === 'issued' && (
        <div className="bg-green-50 border border-green-200 rounded p-4 flex items-start gap-3">
          <CheckCircle2 className="text-green-600 mt-0.5" size={20} />
          <div className="flex-1">
            <h3 className="font-semibold text-green-900">חשבון עסקה הופק במורנינג</h3>
            <p className="text-sm text-green-800 mt-1">
              מספר: <b>{period.morningDocNumber}</b>
              {period.issuedAt && <> · הופק: {new Date(period.issuedAt).toLocaleString('he-IL')}</>}
              {period.dueDate && <> · לתשלום עד: {new Date(period.dueDate).toLocaleDateString('he-IL')}</>}
            </p>
            <div className="flex flex-wrap gap-3 mt-2 text-sm">
              {period.morningDocUrl && (
                <a href={period.morningDocUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-green-700 hover:underline">
                  <ExternalLink size={14} /> חשבון עסקה (PDF)
                </a>
              )}
              {period.taxInvoiceUrl && (
                <a href={period.taxInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-green-700 hover:underline">
                  <ExternalLink size={14} /> חשבונית מס/קבלה #{period.taxInvoiceNumber} (PDF)
                </a>
              )}
            </div>
            <p className="text-xs text-green-900/70 mt-3">
              <b>החודש הזה נעול</b> — אי אפשר להוסיף/למחוק פגישות לחודש הזה במחזורים של המוסד עד שתבוטל הנעילה.
            </p>
            {isAdmin && (
              <div className="mt-3">
                <button
                  onClick={unlockIssued}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-sm bg-amber-100 hover:bg-amber-200 text-amber-900 px-3 py-1.5 rounded border border-amber-300 disabled:opacity-50"
                >
                  <Unlock size={14} /> בטל נעילה (אדמין)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {drift && (drift.newSinceIssue.length > 0 || drift.removedSinceIssue.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5" />
            <div className="flex-1">
              <b>שינוי בפגישות אחרי ההפקה</b> — בעת ההפקה נכללו {drift.snapshotCount} פגישות, ועכשיו יש {drift.currentCount}.
              {drift.newSinceIssue.length > 0 && (
                <div className="mt-2">
                  <b>{drift.newSinceIssue.length} פגישות חדשות שלא חויבו:</b>
                  <ul className="mt-1 list-disc pr-5 space-y-0.5">
                    {drift.newSinceIssue.map((m) => (
                      <li key={m.id}>
                        {new Date(m.scheduledDate).toLocaleDateString('he-IL')} · {m.cycle.name} · {m.instructor.name}
                        {Number(m.instructorPayment) > 0 && (
                          <span className="text-red-700 mx-1">⚠️ שולם למדריך {Number(m.instructorPayment).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs mt-2">שקול ליצור חשבון משלים לחודש הבא או לעדכן את החשבון הקיים ידנית במורנינג.</p>
                </div>
              )}
              {drift.removedSinceIssue.length > 0 && (
                <div className="mt-2">
                  <b>{drift.removedSinceIssue.length} פגישות שכבר לא רלוונטיות</b> (נמחקו / שונה סטטוס לאחר ההפקה).
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {missingTaxId && isDraft && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <div>
            <b>חסר ת.ז עוסק / ח.פ לגוף המשלם</b> — ניתן להפיק גם בלי, אבל מומלץ למלא דרך
            <Link to={`/paying-bodies`} className="underline mx-1">מסך הגופים המשלמים</Link>
            כדי שיופיע על החשבונית במורנינג.
          </div>
        </div>
      )}

      <section className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-gray-900 mb-3">פרטי לקוח (יוצגו בחשבון עסקה)</h2>
        {payer ? (
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><dt className="text-gray-500">שם</dt><dd>{payer.name || '—'}</dd></div>
            <div>
              <dt className="text-gray-500">ח.פ / ת.ז עוסק</dt>
              <dd className={!payer.taxId ? 'text-amber-600' : ''} dir="ltr">{payer.taxId || '⚠️ חסר'}</dd>
            </div>
            <div><dt className="text-gray-500">איש קשר</dt><dd>{payer.contactName || '—'}</dd></div>
            <div><dt className="text-gray-500">מייל</dt><dd dir="ltr">{payer.email || '—'}</dd></div>
            <div><dt className="text-gray-500">טלפון</dt><dd dir="ltr">{payer.phone || '—'}</dd></div>
            <div><dt className="text-gray-500">כתובת</dt><dd>{payer.address || '—'}</dd></div>
            <div><dt className="text-gray-500">עיר</dt><dd>{payer.city || '—'}</dd></div>
          </dl>
        ) : (
          <div className="text-sm text-amber-700 flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>
              להזמנה זו לא מקושר גוף משלם — לא ניתן להפיק חשבון עסקה ללא גוף משלם. קשרו גוף משלם דרך
              <Link to={`/paying-bodies`} className="underline mx-1">מסך הגופים המשלמים</Link>.
            </span>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3">הפרטים נמשכים מהגוף המשלם. לעריכה — מסך הגופים המשלמים.</p>
      </section>

      <section className="bg-white rounded-xl border">
        <div className="p-5 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">שורות חשבון</h2>
          {isDraft && (
            <div className="flex items-center gap-2">
              <button onClick={regenerate} disabled={busy}
                className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1 rounded border">רענן מהפגישות</button>
              <button onClick={() => setShowAddLine(true)}
                className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded border inline-flex items-center gap-1">
                <Plus size={14} /> הוסף שורה
              </button>
            </div>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="text-gray-600 border-b bg-gray-50">
            <tr>
              <th className="text-right p-3">תיאור</th>
              <th className="text-right p-3 w-24">כמות</th>
              <th className="text-right p-3 w-32">מחיר ליחידה</th>
              <th className="text-right p-3 w-32">סכום</th>
              {isDraft && <th className="w-12"></th>}
            </tr>
          </thead>
          <tbody>
            {period.lines.map((line) => (
              <tr key={line.id} className="border-b last:border-b-0">
                <td className="p-2">
                  {isDraft ? (
                    <div>
                      <input
                        key={`${line.id}-${line.description}`}
                        className="form-input"
                        defaultValue={line.description}
                        onBlur={(e) => e.target.value !== line.description && updateLine(line.id, { description: e.target.value })}
                      />
                      {line.descriptionCustomized && (
                        <div className="text-xs text-amber-700 mt-1">✎ תיאור מותאם — לא יידרס בריענון מהפגישות</div>
                      )}
                      {line.studentCount != null && (
                        <div className="text-xs text-gray-500 mt-1">{line.studentCount} ילדים (לפי הרישום באותו חודש)</div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <span>{line.description}</span>
                      {line.studentCount != null && (
                        <div className="text-xs text-gray-500 mt-1">{line.studentCount} ילדים (לפי הרישום באותו חודש)</div>
                      )}
                    </div>
                  )}
                </td>
                <td className="p-2">
                  {isDraft ? (
                    <input type="number" step="0.5" className="form-input" defaultValue={Number(line.quantity)}
                      onBlur={(e) => Number(e.target.value) !== Number(line.quantity) && updateLine(line.id, { quantity: e.target.value as any })} />
                  ) : Number(line.quantity)}
                </td>
                <td className="p-2">
                  {isDraft ? (
                    <input type="number" step="0.01" className="form-input" defaultValue={Number(line.unitPrice)}
                      onBlur={(e) => Number(e.target.value) !== Number(line.unitPrice) && updateLine(line.id, { unitPrice: e.target.value as any })} />
                  ) : Number(line.unitPrice).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}
                </td>
                <td className="p-2 font-medium">
                  {Number(line.total).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}
                </td>
                {isDraft && (
                  <td className="p-2">
                    <button onClick={() => deleteLine(line.id)} className="text-red-600 hover:text-red-800">
                      <Trash2 size={16} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {period.lines.length === 0 && (
              <tr><td colSpan={isDraft ? 5 : 4} className="text-center text-gray-500 p-6">אין שורות</td></tr>
            )}
          </tbody>
          <tfoot className="font-bold">
            {totals.allVatIncluded ? (
              <>
                <tr><td colSpan={isDraft ? 3 : 2} className="p-3 text-left">סה״כ (כולל מע״מ):</td>
                    <td className="p-3">{formatCurrency(totals.totalDue)}</td>
                    {isDraft && <td/>}</tr>
                <tr className="text-gray-600 font-medium"><td colSpan={isDraft ? 3 : 2} className="p-3 text-left">מתוכו מע״מ 18%:</td>
                    <td className="p-3">{formatCurrency(totals.totalDue - (totals.totalDue / 1.18))}</td>
                    {isDraft && <td/>}</tr>
              </>
            ) : (
              <>
                <tr><td colSpan={isDraft ? 3 : 2} className="p-3 text-left">{totals.allVatExcluded ? 'סה״כ נטו (ללא מע״מ):' : 'סה״כ שורות:'}</td>
                    <td className="p-3">{formatCurrency(totals.base)}</td>
                    {isDraft && <td/>}</tr>
                {!totals.allVatExcluded && totals.vatIncluded > 0 && (
                  <tr className="text-gray-600 font-medium"><td colSpan={isDraft ? 3 : 2} className="p-3 text-left">מתוכן שורות כוללות מע״מ:</td>
                      <td className="p-3">{formatCurrency(totals.vatIncluded)}</td>
                      {isDraft && <td/>}</tr>
                )}
                <tr className="text-gray-600"><td colSpan={isDraft ? 3 : 2} className="p-3 text-left">+ מע״מ 18%:</td>
                    <td className="p-3">{formatCurrency(totals.vatToAdd)}</td>
                    {isDraft && <td/>}</tr>
                <tr className="text-base"><td colSpan={isDraft ? 3 : 2} className="p-3 text-left">סה״כ לתשלום:</td>
                    <td className="p-3">{formatCurrency(totals.totalDue)}</td>
                    {isDraft && <td/>}</tr>
              </>
            )}
          </tfoot>
        </table>
      </section>

      {showAddLine && isDraft && (
        <form onSubmit={addLine} className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">שורה ידנית חדשה</h3>
            <button type="button" onClick={() => setShowAddLine(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-3">
              <label className="form-label">תיאור</label>
              <input className="form-input" required value={newLine.description}
                onChange={(e) => setNewLine({ ...newLine, description: e.target.value })} />
            </div>
            <div>
              <label className="form-label">כמות</label>
              <input type="number" step="0.5" className="form-input" required value={newLine.quantity}
                onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })} />
            </div>
            <div>
              <label className="form-label">מחיר ליחידה</label>
              <input type="number" step="0.01" className="form-input" required value={newLine.unitPrice}
                onChange={(e) => setNewLine({ ...newLine, unitPrice: e.target.value })} />
            </div>
          </div>
          <div className="text-left">
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">הוסף</button>
          </div>
        </form>
      )}

      {isDraft && (
        <section className="bg-white rounded-xl border p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">כותרת, הערות + הגדרות הפקה</h2>
          <div>
            <label className="form-label">כותרת / תיאור במסמך (יופיע בחלק העליון)</label>
            <textarea className="form-input" rows={2} defaultValue={period.documentTitle || ''}
              placeholder="לדוגמה: תאריך 19.05.2026 — 3 קבוצות, 2 סדנאות לקבוצה"
              onBlur={(e) => e.target.value !== (period.documentTitle || '') && updateNotesAndEmail({ documentTitle: e.target.value })} />
          </div>
          <div>
            <label className="form-label">הערות בתחתית המסמך</label>
            <textarea className="form-input" rows={2} defaultValue={period.notes || ''}
              placeholder="הערות שיופיעו בתחתית המסמך"
              onBlur={(e) => e.target.value !== (period.notes || '') && updateNotesAndEmail({ notes: e.target.value })} />
          </div>
          <div>
            <label className="form-label">תאריך החשבון עסקה</label>
            <input type="date" className="form-input" value={docDate}
              onChange={(e) => setDocDate(e.target.value)} />
            <p className="text-xs text-gray-500 mt-1">ברירת מחדל: היום. ניתן להזין תאריך אחר (לדוגמה סוף החודש הקודם) לפני ההפקה.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={period.sendByEmail}
              onChange={(e) => updateNotesAndEmail({ sendByEmail: e.target.checked })} />
            שלח את המסמך אוטומטית במייל ללקוח לאחר ההפקה
            {period.sendByEmail && !(payer?.email ?? order.contactEmail) && (
              <span className="text-amber-600 mr-2">⚠️ אין מייל איש קשר</span>
            )}
          </label>
        </section>
      )}

      {isDraft && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button onClick={cancelDraft} disabled={busy}
            className="text-red-600 hover:text-red-800 px-4 py-2 rounded">בטל draft</button>
          <button onClick={() => { setExternalForm({ url: '', documentNumber: '', documentId: '', issuedAt: '' }); setError(null); setShowExternalModal(true); }} disabled={busy}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded inline-flex items-center gap-2 border"
            title="קשר חשבון עסקה שכבר הוצא ידנית במורנינג">
            <ExternalLink size={16} /> קשר חשבון עסקה ממורנינג
          </button>
          <button onClick={preview} disabled={busy}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded inline-flex items-center gap-2 border">
            <Eye size={16} /> תצוגה מקדימה
          </button>
          <button onClick={issue} disabled={busy || period.lines.length === 0}
            className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded inline-flex items-center gap-2 disabled:opacity-50"
            title={period.lines.length === 0 ? 'אין שורות' : ''}>
            <Send size={16} /> אשר והפק במורנינג
          </button>
        </div>
      )}

      {/* ── Payment tracking ─────────────────────────────────────────── */}
      {period.status === 'issued' && (
        <section className="bg-white rounded-xl border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet size={18} className="text-gray-600" />
              <h2 className="font-semibold text-gray-900">מעקב תשלומים</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                period.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' :
                period.paymentStatus === 'partial' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>
                {period.paymentStatus === 'paid' ? 'שולם' :
                 period.paymentStatus === 'partial' ? 'שולם חלקית' : 'טרם שולם'}
              </span>
            </div>
            {!showPaymentForm && period.paymentStatus !== 'paid' && (
              <button onClick={() => setShowPaymentForm(true)}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded inline-flex items-center gap-1">
                <Plus size={14} /> הוסף תשלום
              </button>
            )}
          </div>

          <div className="text-sm text-gray-600">
            שולם: <b>{Number(period.paidAmount).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</b>
            {' '}מתוך{' '}
            <b>{formatCurrency(totals.totalDue)}</b>
            {' '}(כולל מע"מ)
            {Number(period.paidAmount) > 0 && Number(period.paidAmount) < totals.totalDue && (
              <span className="text-amber-700 mr-2">
                · יתרה: {formatCurrency(totals.totalDue - Number(period.paidAmount))}
              </span>
            )}
          </div>

          {period.payments.length > 0 && (
            <table className="w-full text-sm border rounded overflow-hidden">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-right p-2">תאריך</th>
                  <th className="text-right p-2">סכום</th>
                  <th className="text-right p-2">אמצעי תשלום</th>
                  <th className="text-right p-2">הערות</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {period.payments.map((pay) => (
                  <tr key={pay.id} className="border-t">
                    <td className="p-2">{new Date(pay.paidAt).toLocaleDateString('he-IL')}</td>
                    <td className="p-2 font-medium">{Number(pay.amount).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}</td>
                    <td className="p-2">{pay.method || '—'}</td>
                    <td className="p-2 text-gray-500">
                      {pay.morningReceiptNumber ? (
                        pay.morningReceiptUrl ? (
                          <a href={pay.morningReceiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
                            <ExternalLink size={13} /> קבלה #{pay.morningReceiptNumber}
                          </a>
                        ) : `קבלה #${pay.morningReceiptNumber}`
                      ) : (pay.notes || '—')}
                    </td>
                    <td className="p-2">
                      {/* Payments backed by a Morning receipt (400) can't be deleted — the receipt is a signed doc. */}
                      {!pay.morningReceiptId && (
                        <button onClick={() => deletePayment(pay.id)} className="text-red-500 hover:text-red-700">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {showPaymentForm && (
            <form onSubmit={addPayment} className="bg-gray-50 rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm">תשלום חדש</h3>
                <button type="button" onClick={() => setShowPaymentForm(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">סכום (₪)</label>
                  <input type="number" step="0.01" className="form-input" required value={newPayment.amount}
                    onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">תאריך תשלום</label>
                  <input type="date" className="form-input" value={newPayment.paidAt}
                    onChange={(e) => setNewPayment({ ...newPayment, paidAt: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">אמצעי תשלום</label>
                  <input className="form-input" placeholder="העברה / צ׳ק / מזומן…" value={newPayment.method}
                    onChange={(e) => setNewPayment({ ...newPayment, method: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">הערות</label>
                  <input className="form-input" value={newPayment.notes}
                    onChange={(e) => setNewPayment({ ...newPayment, notes: e.target.value })} />
                </div>
              </div>
              <div className="text-left">
                <button type="submit" disabled={busy} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                  שמור תשלום
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* ── Send + tax invoice actions ────────────────────────────────── */}
      {period.status === 'issued' && (
        <section className="bg-white rounded-xl border p-5 space-y-4">
          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-gray-600" />
            <h2 className="font-semibold text-gray-900">שליחה ותיעוד</h2>
            {period.sentAt && (
              <span className="text-xs text-gray-500">
                · נשלח: {new Date(period.sentAt).toLocaleString('he-IL')} דרך {period.sentChannel}
                {period.sentToPhone && ` → ${period.sentToPhone}`}
                {period.sentToEmail && ` → ${period.sentToEmail}`}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={openWhatsApp} disabled={!period.morningDocUrl}
              className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-sm disabled:opacity-40"
              title={!period.morningDocUrl ? 'אין קישור מסמך' : ''}>
              <MessageCircle size={15} /> שלח בWhatsApp
            </button>

            <button onClick={() => markSent('manual')}
              className="inline-flex items-center gap-2 bg-gray-100 hover:bg-gray-200 border text-gray-700 px-4 py-2 rounded text-sm">
              <CheckCircle2 size={15} /> סמן כנשלח (ידני)
            </button>

            {!period.taxInvoiceId && (
              <button onClick={openTaxModal} disabled={busy}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                <FileCheck2 size={15} /> הפק חשבונית מס
              </button>
            )}
            {!period.taxInvoiceId && (
              <button onClick={openLinkTaxModal} disabled={busy}
                className="inline-flex items-center gap-2 border border-indigo-600 text-indigo-700 hover:bg-indigo-50 px-4 py-2 rounded text-sm disabled:opacity-50">
                <ExternalLink size={15} /> קשר חשבונית מס ממורנינג
              </button>
            )}
            {period.taxInvoiceId && period.taxInvoiceUrl && (
              <a href={period.taxInvoiceUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 border text-indigo-700 hover:bg-indigo-50 px-4 py-2 rounded text-sm">
                <FileCheck2 size={15} /> {period.taxInvoiceType === 305 ? 'חשבונית מס' : 'חשבונית מס/קבלה'} #{period.taxInvoiceNumber}
              </a>
            )}
            {period.taxInvoiceType === 305 && period.paymentStatus !== 'paid' && (
              <button onClick={openReceiptModal} disabled={busy}
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                <Wallet size={15} /> הפק קבלה (400)
              </button>
            )}
            {period.taxInvoiceType === 305 && period.paymentStatus !== 'paid' && (
              <button onClick={openLinkReceiptModal} disabled={busy}
                className="inline-flex items-center gap-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 px-4 py-2 rounded text-sm disabled:opacity-50">
                <ExternalLink size={15} /> קשר קבלה ממורנינג
              </button>
            )}
          </div>

          {showWhatsAppForm && (
            <form onSubmit={sendWhatsApp} className="bg-gray-50 rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm">שליחת WhatsApp</h3>
                <button type="button" onClick={() => setShowWhatsAppForm(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <div>
                <label className="form-label">מספר טלפון (כולל קידומת בינ"ל)</label>
                <input className="form-input" dir="ltr" placeholder="972501234567" required value={waPhone}
                  onChange={(e) => setWaPhone(e.target.value)} />
              </div>
              <div>
                <label className="form-label">תוכן ההודעה</label>
                <textarea className="form-input" rows={6} value={waMessage}
                  onChange={(e) => setWaMessage(e.target.value)} />
              </div>
              <div className="text-left">
                <button type="submit" disabled={busy || !waPhone}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                  שלח
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* ── Tax invoice + receipt (320) preview & edit modal ──────────────── */}
      {showTaxModal && period && (() => {
        const documentGross = billingTotals(period.lines, period.totalAmount).totalDue;
        const paymentsSum = taxPayments.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const mismatch = Math.abs(paymentsSum - documentGross) > 0.01;
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b p-4">
                <h3 className="font-semibold text-gray-900">
                  {taxMode === '305' ? 'הפקת חשבונית מס בלבד (305)' : 'הפקת חשבונית מס/קבלה (320)'}
                </h3>
                <button onClick={() => setShowTaxModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>

              <div className="p-4 space-y-4">
                <div className="space-y-2">
                  <label className="form-label mb-0">סוג מסמך</label>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="radio" className="mt-1" checked={taxMode === '320'} onChange={() => setTaxMode('320')} />
                      <span><b>חשבונית מס + קבלה (320)</b> — ברירת מחדל. מסמך אחד הכולל את החשבונית והקבלה יחד (לאחר קבלת התשלום).</span>
                    </label>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="radio" className="mt-1" checked={taxMode === '305'} onChange={() => setTaxMode('305')} />
                      <span><b>חשבונית מס בלבד (305)</b> — הכרה בהכנסה לפני קבלת הכסף. את הקבלות (400) תפיק בנפרד, מקושרות לחשבונית, עד שייכנס מלוא הסכום.</span>
                    </label>
                  </div>
                </div>

                {taxMode === '320' && (
                  <p className="text-sm text-gray-600">
                    פירוט התקבולים יופיע בקבלה. ברירת המחדל נטענה מהתשלומים שתועדו במערכת — ניתן לערוך, להוסיף או למחוק לפני ההפקה.
                  </p>
                )}

                <div>
                  <label className="form-label">תאריך החשבונית</label>
                  <input type="date" className="form-input w-48" value={taxDocDate}
                    onChange={(e) => setTaxDocDate(e.target.value)} />
                  <p className="text-xs text-gray-400 mt-1">
                    התאריך שיופיע על החשבונית (ברירת מחדל: תאריך התקבול/הצ׳ק). תיארוך אחורה מוגבל לחלון שמורנינג מאפשר.
                  </p>
                </div>

                {taxMode === '320' && (
                <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="form-label mb-0">פירוט תקבולים</label>
                    <button type="button" onClick={addTaxRow}
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800">
                      <Plus size={14} /> הוסף תקבול
                    </button>
                  </div>

                  {taxPayments.length === 0 && (
                    <p className="text-sm text-gray-400 py-2">אין תקבולים. הוסף לפחות תקבול אחד.</p>
                  )}

                  {taxPayments.map((row, i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input type="date" className="form-input flex-shrink-0" value={row.date}
                          onChange={(e) => updateTaxRow(i, { date: e.target.value })} />
                        <select className="form-input" value={row.type}
                          onChange={(e) => updateTaxRow(i, { type: Number(e.target.value) })}>
                          {PAYMENT_TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <input type="number" step="0.01" min="0" dir="ltr" placeholder="סכום"
                          className="form-input w-32 flex-shrink-0" value={row.amount}
                          onChange={(e) => updateTaxRow(i, { amount: e.target.value })} />
                        <button type="button" onClick={() => removeTaxRow(i)} className="text-red-500 hover:text-red-700 flex-shrink-0">
                          <Trash2 size={16} />
                        </button>
                      </div>
                      {row.type === 2 && (
                        <div className="flex items-center gap-2 flex-wrap pr-2">
                          <input className="form-input w-28" placeholder="מס׳ צ׳ק" value={row.chequeNum || ''}
                            onChange={(e) => updateTaxRow(i, { chequeNum: e.target.value })} />
                          <input className="form-input w-40" placeholder="שם בנק" value={row.bankName || ''}
                            onChange={(e) => updateTaxRow(i, { bankName: e.target.value })} />
                          <input className="form-input w-24" placeholder="סניף" value={row.bankBranch || ''}
                            onChange={(e) => updateTaxRow(i, { bankBranch: e.target.value })} />
                          <input className="form-input w-36" placeholder="מס׳ חשבון" value={row.bankAccount || ''}
                            onChange={(e) => updateTaxRow(i, { bankAccount: e.target.value })} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="bg-gray-50 rounded-lg border p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-600">סה״כ מסמך (כולל מע״מ)</span>
                    <b>{formatCurrency(documentGross)}</b>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">סה״כ תקבולים</span>
                    <b className={mismatch ? 'text-red-600' : 'text-green-700'}>{formatCurrency(paymentsSum)}</b>
                  </div>
                  {mismatch && (
                    <div className="flex items-center gap-1 text-red-600 pt-1">
                      <AlertCircle size={14} />
                      <span>סכום התקבולים אינו תואם לסכום המסמך — מורנינג עלול לדחות את ההפקה.</span>
                    </div>
                  )}
                </div>
                </>
                )}

                {taxMode === '305' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 flex items-start gap-2">
                    <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                    <span>חשבונית מס בלבד — ללא תקבול. לאחר ההפקה תוכל להפיק קבלות (400) מקושרות מאזור מעקב התשלומים, והשורה תישאר פתוחה עד לקבלת מלוא הסכום.</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t p-4">
                {taxMode === '320' ? (
                  <button onClick={previewTaxInvoice} disabled={taxBusy}
                    className="inline-flex items-center gap-2 border text-gray-700 hover:bg-gray-50 px-4 py-2 rounded text-sm disabled:opacity-50">
                    <Eye size={16} /> תצוגה מקדימה
                  </button>
                ) : <span />}
                <button onClick={confirmIssueTaxInvoice} disabled={taxBusy || (taxMode === '320' && taxPayments.length === 0)}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                  <FileCheck2 size={16} /> {taxMode === '305' ? 'הפק חשבונית מס בלבד' : 'הפק חשבונית מס/קבלה'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Standalone receipt (400) modal — links to the period's 305 tax invoice ── */}
      {showReceiptModal && period && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-gray-900">הפקת קבלה (400)</h3>
              <button onClick={() => setShowReceiptModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-600">
                הקבלה תקושר לחשבונית המס #{period.taxInvoiceNumber}. ניתן להפיק מספר קבלות חלקיות — השורה תיסגר רק כשמלוא הסכום יתקבל.
              </p>
              <div className="text-sm text-gray-600">
                שולם עד כה: <b>{formatCurrency(Number(period.paidAmount))}</b> מתוך{' '}
                <b>{formatCurrency(billingTotals(period.lines, period.totalAmount).totalDue)}</b>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">סכום הקבלה (₪)</label>
                  <input type="number" step="0.01" min="0" dir="ltr" className="form-input" value={receiptForm.amount}
                    onChange={(e) => setReceiptForm({ ...receiptForm, amount: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">תאריך הקבלה</label>
                  <input type="date" className="form-input" value={receiptForm.documentDate}
                    onChange={(e) => setReceiptForm({ ...receiptForm, documentDate: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="form-label">אמצעי תשלום</label>
                  <select className="form-input" value={receiptForm.method}
                    onChange={(e) => setReceiptForm({ ...receiptForm, method: e.target.value })}>
                    {PAYMENT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.label}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t p-4">
              <button onClick={() => setShowReceiptModal(false)} className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded text-sm">ביטול</button>
              <button onClick={confirmIssueReceipt} disabled={receiptBusy || !(Number(receiptForm.amount) > 0)}
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                <Wallet size={16} /> הפק קבלה
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link an externally-issued Morning tax invoice (305 / 320) ── */}
      {showLinkTaxModal && period && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-gray-900">קישור חשבונית מס ממורנינג</h3>
              <button onClick={() => setShowLinkTaxModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-600">
                הוצאת חשבונית מס ידנית במורנינג (לא דרך המערכת)? קשר אותה כאן — המערכת <b>לא</b> תפיק מסמך חדש במורנינג.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="form-label">סוג מסמך</label>
                  <select className="form-input" value={linkTaxForm.documentType}
                    onChange={(e) => setLinkTaxForm({ ...linkTaxForm, documentType: e.target.value as '305' | '320' })}>
                    <option value="320">חשבונית מס/קבלה (320) — כולל קבלה, יסגור כשולם</option>
                    <option value="305">חשבונית מס בלבד (305) — ללא קבלה, תשלום פתוח</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">מספר מסמך במורנינג</label>
                    <input type="number" dir="ltr" className="form-input" placeholder="לדוגמה: 55733" value={linkTaxForm.documentNumber}
                      onChange={(e) => setLinkTaxForm({ ...linkTaxForm, documentNumber: e.target.value })} />
                  </div>
                  <div>
                    <label className="form-label">תאריך המסמך</label>
                    <input type="date" className="form-input" value={linkTaxForm.issuedAt}
                      onChange={(e) => setLinkTaxForm({ ...linkTaxForm, issuedAt: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="form-label">קישור למסמך (אופציונלי)</label>
                  <input dir="ltr" className="form-input" placeholder="https://app.greeninvoice.co.il/..." value={linkTaxForm.url}
                    onChange={(e) => setLinkTaxForm({ ...linkTaxForm, url: e.target.value })} />
                </div>
              </div>
              {linkTaxForm.documentType === '320' && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  קישור 320 יסמן את התקופה כ<b>שולם במלואו</b> (סכום: {formatCurrency(billingTotals(period.lines, period.totalAmount).totalDue)}) — כי 320 כולל קבלה.
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 border-t p-4">
              <button onClick={() => setShowLinkTaxModal(false)} className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded text-sm">ביטול</button>
              <button onClick={submitLinkTax} disabled={linkTaxBusy || (!linkTaxForm.documentNumber && !linkTaxForm.url)}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                <ExternalLink size={16} /> קשר חשבונית מס
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link an externally-issued Morning receipt (קבלה) to the 305 tax invoice ── */}
      {showLinkReceiptModal && period && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-gray-900">קישור קבלה ממורנינג</h3>
              <button onClick={() => setShowLinkReceiptModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-600">
                הוצאת את הקבלה ידנית במורנינג (לא דרך המערכת)? הזן את מספר הקבלה והסכום — המערכת תרשום את התשלום ותקשר אותו לחשבונית המס #{period.taxInvoiceNumber}, <b>בלי</b> להפיק מסמך חדש במורנינג.
              </p>
              <div className="text-sm text-gray-600">
                שולם עד כה: <b>{formatCurrency(Number(period.paidAmount))}</b> מתוך{' '}
                <b>{formatCurrency(billingTotals(period.lines, period.totalAmount).totalDue)}</b>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">סכום הקבלה (₪)</label>
                  <input type="number" step="0.01" min="0" dir="ltr" className="form-input" value={linkReceiptForm.amount}
                    onChange={(e) => setLinkReceiptForm({ ...linkReceiptForm, amount: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">תאריך הקבלה</label>
                  <input type="date" className="form-input" value={linkReceiptForm.paidAt}
                    onChange={(e) => setLinkReceiptForm({ ...linkReceiptForm, paidAt: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">מספר הקבלה במורנינג</label>
                  <input type="number" dir="ltr" className="form-input" placeholder="לדוגמה: 83012" value={linkReceiptForm.documentNumber}
                    onChange={(e) => setLinkReceiptForm({ ...linkReceiptForm, documentNumber: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">אמצעי תשלום</label>
                  <select className="form-input" value={linkReceiptForm.method}
                    onChange={(e) => setLinkReceiptForm({ ...linkReceiptForm, method: e.target.value })}>
                    {PAYMENT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.label}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="form-label">קישור לקבלה במורנינג (אופציונלי)</label>
                  <input dir="ltr" className="form-input" placeholder="https://app.greeninvoice.co.il/..." value={linkReceiptForm.url}
                    onChange={(e) => setLinkReceiptForm({ ...linkReceiptForm, url: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                שים לב: פעולה זו רושמת תשלום בלבד ואינה יוצרת מסמך במורנינג. עדיף להזין את מספר הקבלה (או קישור הכולל את מזהה המסמך) כדי שהמערכת תקשר חזרה לקבלה החתומה.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 border-t p-4">
              <button onClick={() => setShowLinkReceiptModal(false)} className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded text-sm">ביטול</button>
              <button onClick={submitLinkReceipt} disabled={linkReceiptBusy || !(Number(linkReceiptForm.amount) > 0) || (!linkReceiptForm.url && !linkReceiptForm.documentNumber)}
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                <ExternalLink size={16} /> קשר קבלה
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link an externally-issued Morning proforma (חשבון עסקה) ── */}
      {showExternalModal && period && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-gray-900">קישור חשבון עסקה ממורנינג</h3>
              <button onClick={() => setShowExternalModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-600">
                הוצאת חשבון עסקה ידנית במורנינג (למשל כדי לתארך אחורה)? הזן את מספר המסמך והקישור — המערכת תמשוך ממורנינג את הפרטים הזמינים ותסמן את החיוב כאילו הופק.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="form-label">מספר מסמך במורנינג</label>
                  <input type="number" dir="ltr" className="form-input" placeholder="לדוגמה: 1234" value={externalForm.documentNumber}
                    onChange={(e) => setExternalForm({ ...externalForm, documentNumber: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">קישור למסמך (אופציונלי)</label>
                  <input dir="ltr" className="form-input" placeholder="https://app.greeninvoice.co.il/..." value={externalForm.url}
                    onChange={(e) => setExternalForm({ ...externalForm, url: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">תאריך המסמך (אופציונלי)</label>
                  <input type="date" className="form-input w-48" value={externalForm.issuedAt}
                    onChange={(e) => setExternalForm({ ...externalForm, issuedAt: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                שים לב: קישור שיתוף ציבורי ממורנינג אינו תמיד ניתן לפענוח אוטומטי. עדיף להזין את מספר המסמך כדי שהמערכת תוכל למשוך את הפרטים. יש לוודא את הקישור מול מורנינג.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 border-t p-4">
              <button onClick={() => setShowExternalModal(false)} className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded text-sm">ביטול</button>
              <button onClick={submitExternalProforma} disabled={externalBusy || (!externalForm.url && !externalForm.documentNumber && !externalForm.documentId)}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                <ExternalLink size={16} /> קשר חשבון עסקה
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
