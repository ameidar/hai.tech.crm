import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Wallet, Search, Edit2, Trash2, AlertTriangle, CheckCircle2, Link2, Loader2, HelpCircle, ArrowLeftRight, ArrowRight, ArrowLeft, ExternalLink } from 'lucide-react';
import {
  usePayingBodies,
  useCreatePayingBody,
  useUpdatePayingBody,
  useDeletePayingBody,
  searchMorningClients,
  comparePayingBodyMorning,
  syncPayingBodyMorning,
} from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCardGrid } from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal';
import type {
  PayingBody,
  MorningClientResult,
  PayingBodyMorningCompare,
  PayingBodyFieldDiff,
  PayingBodySyncDirection,
  PayingBodySyncField,
} from '../types';

const SYNC_FIELD_LABEL: Record<PayingBodySyncField, string> = {
  name: 'שם',
  taxId: 'ח.פ / ת.ז',
  email: 'מייל',
  phone: 'טלפון',
  address: 'כתובת',
  city: 'עיר',
  zip: 'מיקוד',
};

// Required fields for a complete paying body — kept in sync with the backend `isComplete`.
const REQUIRED_FIELDS: { key: 'name' | 'taxId' | 'contactName' | 'email'; label: string }[] = [
  { key: 'name', label: 'שם' },
  { key: 'taxId', label: 'ח.פ/ת.ז' },
  { key: 'contactName', label: 'איש קשר' },
  { key: 'email', label: 'מייל' },
];

const missingFields = (b: Partial<PayingBody>): string[] =>
  REQUIRED_FIELDS.filter((f) => !((b[f.key] as string | null | undefined) || '').toString().trim()).map((f) => f.label);

// Deep link to a client's card in Morning's web app (verified format).
const morningClientLink = (id: string) => `https://app.greeninvoice.co.il/incomes/clients/${id}/contact`;

export default function PayingBodies() {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<PayingBody | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<PayingBody | null>(null);
  const [comparing, setComparing] = useState<PayingBody | null>(null);
  const [search, setSearch] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const { data: bodies, isLoading } = usePayingBodies();
  const createBody = useCreatePayingBody();
  const updateBody = useUpdatePayingBody();
  const deleteBody = useDeletePayingBody();

  const list = (bodies ?? []).filter((b) => {
    if (onlyIncomplete && b.isComplete) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return b.name.toLowerCase().includes(s) || (b.taxId || '').toLowerCase().includes(s);
  });

  const incompleteCount = (bodies ?? []).filter((b) => !b.isComplete).length;

  const handleCreate = async (data: Partial<PayingBody>) => {
    try {
      await createBody.mutateAsync(data);
      setShowAdd(false);
    } catch (e: any) {
      alert(e?.response?.data?.message || e?.response?.data?.error || 'שמירת הגוף המשלם נכשלה');
    }
  };

  const handleUpdate = async (data: Partial<PayingBody>) => {
    if (!editing) return;
    try {
      await updateBody.mutateAsync({ id: editing.id, data });
      setEditing(null);
    } catch (e: any) {
      alert(e?.response?.data?.message || e?.response?.data?.error || 'עדכון הגוף המשלם נכשל');
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteBody.mutateAsync(deleteConfirm.id);
      setDeleteConfirm(null);
    } catch (e: any) {
      alert(e?.response?.data?.message || 'מחיקת הגוף המשלם נכשלה');
    }
  };

  return (
    <>
      <PageHeader
        title="גופים משלמים"
        subtitle={`${list.length} גופים${incompleteCount ? ` · ${incompleteCount} חסרי השלמה` : ''}`}
        actions={
          <button onClick={() => setShowAdd(true)} className="btn btn-primary" title="צור גוף משלם חדש — אפשר לחפש ולקשר ללקוח קיים במורנינג כדי למנוע כפילות">
            <Plus size={18} /> גוף משלם חדש
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        <div className="mb-6 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם או ח.פ..."
              className="form-input pr-10 w-full"
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyIncomplete((v) => !v)}
            className={`btn ${onlyIncomplete ? 'btn-primary' : 'btn-secondary'}`}
            title="הצג רק גופים משלמים שחסרים להם פרטי חובה"
          >
            <AlertTriangle size={16} /> חסרי השלמה{incompleteCount ? ` (${incompleteCount})` : ''}
          </button>
          <span className="text-sm text-gray-500 mr-auto">{list.length} גופים משלמים</span>
        </div>

        {isLoading ? (
          <SkeletonCardGrid count={6} />
        ) : list.length > 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="p-3 text-right font-medium text-gray-600">שם</th>
                  <th className="p-3 text-right font-medium text-gray-600">ח.פ / ת.ז</th>
                  <th className="p-3 text-right font-medium text-gray-600">איש קשר</th>
                  <th className="p-3 text-right font-medium text-gray-600">מייל</th>
                  <th className="p-3 text-center font-medium text-gray-600">
                    <span className="inline-flex items-center gap-1">מורנינג
                      <span title="האם הגוף המשלם מקושר ללקוח קיים במורנינג. מקושר = החיוב מופק לפי המזהה ולא נוצרת כפילות. הסימון ליד החוליה מציין אם הפרטים מסונכרנים: ✓ ירוק = זהה למורנינג · מספר כתום = יש פערים, כדאי להשוות ולסנכרן · משולש אדום = התנגשות ח.פ (אולי קושר הלקוח הלא נכון)." className="text-gray-400 cursor-help"><HelpCircle size={13} /></span>
                    </span>
                  </th>
                  <th className="p-3 text-center font-medium text-gray-600">הזמנות</th>
                  <th className="p-3 text-center font-medium text-gray-600">
                    <span className="inline-flex items-center gap-1">סטטוס
                      <span title="'מלא' = יש שם, ח.פ/ת.ז, איש קשר ומייל, וניתן להפיק חיוב. 'חסר השלמה' = חסרים שדות חובה והחיוב חסום עד שמשלימים." className="text-gray-400 cursor-help"><HelpCircle size={13} /></span>
                    </span>
                  </th>
                  <th className="p-3 text-right font-medium text-gray-600">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {list.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center text-white shrink-0">
                          <Wallet size={14} />
                        </div>
                        <span className="font-medium text-gray-900">{b.name}</span>
                      </div>
                    </td>
                    <td className="p-3 text-gray-600" dir="ltr">{b.taxId || '-'}</td>
                    <td className="p-3 text-gray-600">{b.contactName || '-'}</td>
                    <td className="p-3 text-gray-600" dir="ltr">{b.email || '-'}</td>
                    <td className="p-3 text-center">
                      {b.morningClientId ? (
                        <MorningDiffBadge body={b} />
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="p-3 text-center text-gray-600">{b._count?.institutionalOrders ?? 0}</td>
                    <td className="p-3 text-center">
                      {b.isComplete ? (
                        <span className="inline-flex items-center gap-1 badge badge-success" title="כל שדות החובה מלאים — אפשר להפיק חיוב לגוף משלם זה."><CheckCircle2 size={13} /> מלא</span>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <span className="inline-flex items-center gap-1 badge badge-warning" title="חסרים שדות חובה. לא ניתן להפיק חיוב לגוף משלם זה עד שמשלימים אותם."><AlertTriangle size={13} /> חסר השלמה</span>
                          {missingFields(b).length > 0 && (
                            <span className="text-[11px] text-amber-700" title="השדות שעדיין חסרים כדי שאפשר יהיה לחייב">חסר: {missingFields(b).join(', ')}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        {!b.isComplete && (
                          <button onClick={() => setEditing(b)} className="btn btn-primary py-1 px-2 text-xs" title="פתח להשלמת שדות החובה — אפשר למשוך את הפרטים אוטומטית ממורנינג">השלם</button>
                        )}
                        {b.morningClientId && (
                          <button onClick={() => setComparing(b)} className="p-1.5 hover:bg-emerald-100 rounded transition-colors text-emerald-600" title="השווה את הפרטים מול הלקוח במורנינג וסנכרן הבדלים (לכל שדה אפשר לבחור כיוון)"><ArrowLeftRight size={14} /></button>
                        )}
                        <button onClick={() => setEditing(b)} className="p-1.5 hover:bg-blue-100 rounded transition-colors text-blue-600" title="עריכת פרטי הגוף המשלם"><Edit2 size={14} /></button>
                        <button onClick={() => setDeleteConfirm(b)} className="p-1.5 hover:bg-red-100 rounded transition-colors text-red-500" title="מחיקה (חסומה אם מקושרות הזמנות)"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Wallet size={40} />}
            title="אין גופים משלמים"
            description="גוף משלם הוא מי שמחויב על ההזמנות המוסדיות — מקביל ללקוח במורנינג. הוסף גוף משלם כדי לקשר אליו הזמנות."
            action={<button onClick={() => setShowAdd(true)} className="btn btn-primary"><Plus size={18} /> הוסף גוף משלם ראשון</button>}
          />
        )}
      </div>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="גוף משלם חדש" size="lg">
        <PayingBodyForm onSubmit={handleCreate} onCancel={() => setShowAdd(false)} isLoading={createBody.isPending} />
      </Modal>
      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title="עריכת גוף משלם" size="lg">
        {editing && <PayingBodyForm body={editing} onSubmit={handleUpdate} onCancel={() => setEditing(null)} isLoading={updateBody.isPending} />}
      </Modal>
      <Modal isOpen={!!comparing} onClose={() => setComparing(null)} title="השוואה וסנכרון מול מורנינג" size="lg">
        {comparing && <MorningCompareModal body={comparing} onClose={() => setComparing(null)} />}
      </Modal>
      <ConfirmDeleteModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
        title="מחיקת גוף משלם"
        itemName={deleteConfirm?.name}
        warningText={(deleteConfirm?._count?.institutionalOrders || 0) > 0 ? `לגוף זה מקושרות ${deleteConfirm?._count?.institutionalOrders} הזמנות. לא ניתן למחוק.` : undefined}
        isLoading={deleteBody.isPending}
      />
    </>
  );
}

interface FormProps {
  body?: PayingBody;
  onSubmit: (data: Partial<PayingBody>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function PayingBodyForm({ body, onSubmit, onCancel, isLoading }: FormProps) {
  const [form, setForm] = useState({
    name: body?.name || '',
    taxId: body?.taxId || '',
    contactName: body?.contactName || '',
    email: body?.email || '',
    phone: body?.phone || '',
    address: body?.address || '',
    city: body?.city || '',
    zip: body?.zip || '',
    morningClientId: body?.morningClientId || '',
  });
  const [error, setError] = useState<string | null>(null);

  // Morning client search
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<MorningClientResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  // When a saved body is already linked, the Morning box shows the linked client + inline compare.
  // "Replace link" flips it back to search mode.
  const [replacing, setReplacing] = useState(false);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Highlight required fields that are still empty so completing a legacy body is obvious.
  const reqClass = (v: string) => `form-input ${!v.trim() ? 'ring-1 ring-amber-400 border-amber-400' : ''}`;
  const stillMissing = missingFields({
    name: form.name, taxId: form.taxId, contactName: form.contactName, email: form.email,
  });

  // Required-field label with a tooltip explaining why it's mandatory (the billing gate).
  const reqLabel = (text: string, help: string) => (
    <label className="form-label flex items-center gap-1">
      {text} *
      <span title={help} className="text-gray-400 hover:text-gray-600 cursor-help"><HelpCircle size={13} /></span>
    </label>
  );

  const handleMorningSearch = async () => {
    setSearchError(null);
    setResults(null);
    if (!form.name.trim() && !form.taxId.trim()) {
      setSearchError('הזן שם או ח.פ לפני חיפוש');
      return;
    }
    setSearching(true);
    try {
      const found = await searchMorningClients({ name: form.name.trim() || undefined, taxId: form.taxId.trim() || undefined });
      setResults(found);
    } catch (e: any) {
      setSearchError(e?.response?.data?.message || e?.response?.data?.error || 'החיפוש במורנינג נכשל');
    } finally {
      setSearching(false);
    }
  };

  const applyMorningClient = (c: MorningClientResult) => {
    set({
      morningClientId: c.id,
      name: c.name || form.name,
      taxId: c.taxId || form.taxId,
      email: (c.emails && c.emails[0]) || form.email,
      phone: c.phone || form.phone,
      address: c.address || form.address,
      city: c.city || form.city,
    });
    setResults(null);
    setReplacing(false);
  };

  // After an inline sync, mirror the fresh CRM-side values back into the form so saving the form
  // afterwards won't clobber fields that were just pulled from Morning. contactName isn't synced.
  const onMorningSynced = (fresh: PayingBodyMorningCompare) => {
    const byField: Partial<Record<PayingBodySyncField, string | null>> = {};
    fresh.fields.forEach((f) => { byField[f.field] = f.crm; });
    set({
      name: byField.name ?? form.name,
      taxId: byField.taxId ?? '',
      email: byField.email ?? '',
      phone: byField.phone ?? '',
      address: byField.address ?? '',
      city: byField.city ?? '',
      zip: byField.zip ?? '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.taxId.trim() || !form.contactName.trim() || !form.email.trim()) {
      setError('שם, ח.פ/ת.ז, איש קשר ומייל הם שדות חובה.');
      return;
    }
    onSubmit({
      name: form.name.trim(),
      taxId: form.taxId.trim(),
      contactName: form.contactName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      zip: form.zip.trim() || null,
      morningClientId: form.morningClientId.trim() || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      {/* Morning link / search */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
        {form.morningClientId && !replacing ? (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-emerald-800">
                <span className="font-medium inline-flex items-center gap-1"><Link2 size={14} /> מקושר ללקוח במורנינג</span>
                <p className="text-emerald-700 text-xs mt-0.5">החיוב יופק לפי הלקוח המקושר — בלי ליצור כפילות.</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={morningClientLink(form.morningClientId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                  title="פתח את כרטיס הלקוח במורנינג בלשונית חדשה"
                >
                  <ExternalLink size={15} /> פתח במורנינג
                </a>
                <button type="button" onClick={() => { setReplacing(true); setResults(null); setSearchError(null); }} className="btn btn-secondary" title="חפש ובחר לקוח אחר במורנינג במקום הקישור הנוכחי">
                  <Search size={15} /> החלף קישור
                </button>
                <button type="button" onClick={() => set({ morningClientId: '' })} className="text-emerald-500 hover:text-red-500 px-1" title="נתק את הקישור ללקוח במורנינג">✕</button>
              </div>
            </div>

            {body?.id && body.morningClientId === form.morningClientId ? (
              <div className="mt-4 border-t border-emerald-200 pt-3">
                <div className="text-xs font-medium text-emerald-800 mb-2">השוואה מול מורנינג</div>
                <MorningComparePanel body={body} onSynced={onMorningSynced} />
              </div>
            ) : (
              <div className="mt-3 text-xs text-emerald-700 bg-white border border-emerald-200 rounded px-2 py-1.5">
                שמרי את הגוף המשלם כדי לעדכן את הקישור ולראות השוואה מול מורנינג.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-emerald-800">
                <span className="font-medium">חיפוש לקוח קיים במורנינג</span>
                <p className="text-emerald-700 text-xs mt-0.5">חפש לפי השם או הח.פ כדי להתחבר ללקוח קיים ולמנוע כפילות.</p>
              </div>
              <div className="flex items-center gap-2">
                {replacing && (
                  <button type="button" onClick={() => { setReplacing(false); setResults(null); setSearchError(null); }} className="btn btn-secondary" title="חזרה לקישור הקיים בלי לשנות">ביטול</button>
                )}
                <button type="button" onClick={handleMorningSearch} disabled={searching} className="btn btn-secondary" title="מלאו שם או ח.פ ולחצו — נחפש לקוח קיים במורנינג, וכשבוחרים אותו נמשכים הפרטים אוטומטית ונשמר הקישור (בלי כפילות)">
                  {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} חפש במורנינג
                </button>
              </div>
            </div>
            {searchError && <div className="mt-3 text-sm text-red-600">{searchError}</div>}
            {results && (
              <div className="mt-3 max-h-52 overflow-auto rounded border border-emerald-200 bg-white divide-y">
                {results.length === 0 ? (
                  <div className="p-3 text-sm text-gray-500">לא נמצאו לקוחות תואמים במורנינג. אפשר להמשיך וליצור גוף משלם חדש.</div>
                ) : (
                  results.map((c) => (
                    <div key={c.id} className="p-3 flex items-center justify-between gap-3 hover:bg-emerald-50">
                      <div className="text-sm">
                        <div className="font-medium text-gray-900">{c.name}</div>
                        <div className="text-gray-500 text-xs" dir="ltr">{[c.taxId, c.emails?.[0]].filter(Boolean).join(' · ') || '—'}</div>
                      </div>
                      <button type="button" onClick={() => applyMorningClient(c)} className="btn btn-secondary py-1 px-3 text-sm">בחר</button>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {body && !body.isComplete && stillMissing.length > 0 && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          גוף משלם זה אינו שלם. כדי לאפשר חיוב יש להשלים: <span className="font-medium">{stillMissing.join(', ')}</span>.
          אפשר למשוך פרטים אוטומטית בעזרת "חפש במורנינג" למעלה.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          {reqLabel('שם הגוף המשלם', 'שם המשלם — זהו גם שם הלקוח שיופיע במורנינג ("לכבוד" על החשבונית). שדה חובה לחיוב.')}
          <input type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} className={reqClass(form.name)} required />
        </div>
        <div>
          {reqLabel('ח.פ / ת.ז', 'מספר העוסק/חברה (ח.פ) או ת.ז של המשלם. נדרש לזיהוי הלקוח במורנינג ומונע כפילויות. שדה חובה לחיוב.')}
          <input type="text" value={form.taxId} onChange={(e) => set({ taxId: e.target.value })} className={reqClass(form.taxId)} dir="ltr" required />
        </div>
        <div>
          {reqLabel('איש קשר', 'שם איש הקשר אצל המשלם. נשמר אצלנו במערכת (לא נשלח כשדה נפרד למורנינג). שדה חובה לחיוב.')}
          <input type="text" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} className={reqClass(form.contactName)} required />
        </div>
        <div>
          {reqLabel('מייל', 'כתובת המייל לשליחת מסמכי החיוב. שדה חובה לחיוב.')}
          <input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} className={reqClass(form.email)} dir="ltr" required />
        </div>
        <div>
          <label className="form-label">טלפון</label>
          <input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} className="form-input" dir="ltr" />
        </div>
        <div>
          <label className="form-label">כתובת</label>
          <input type="text" value={form.address} onChange={(e) => set({ address: e.target.value })} className="form-input" />
        </div>
        <div>
          <label className="form-label">עיר</label>
          <input type="text" value={form.city} onChange={(e) => set({ city: e.target.value })} className="form-input" />
        </div>
        <div>
          <label className="form-label">מיקוד</label>
          <input type="text" value={form.zip} onChange={(e) => set({ zip: e.target.value })} className="form-input" dir="ltr" />
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">ביטול</button>
        <button type="submit" className="btn btn-primary" disabled={isLoading}>{isLoading ? 'שומר...' : 'שמור'}</button>
      </div>
    </form>
  );
}

const valueCell = (v: string | null) =>
  v ? <span className="text-gray-900" dir="auto">{v}</span> : <span className="text-gray-300">ריק</span>;

// Passive per-row indicator: lazily compares a linked paying body against its Morning client so the
// user can see at a glance whether there are differences, without opening each one. Cached for a few
// minutes so opening the list doesn't re-hit Morning on every render.
function MorningDiffBadge({ body }: { body: PayingBody }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['paying-body-morning-diff', body.id],
    queryFn: () => comparePayingBodyMorning(body.id),
    enabled: !!body.morningClientId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600" title={`מקושר ללקוח במורנינג (${body.morningClientId}) — בודק פערים...`}>
        <Link2 size={15} /><Loader2 size={11} className="animate-spin text-gray-400" />
      </span>
    );
  }
  if (isError || !data) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600" title={`מקושר ללקוח במורנינג (${body.morningClientId}) — לא ניתן לבדוק פערים כרגע`}>
        <Link2 size={15} />
      </span>
    );
  }

  const changed = data.fields.filter((f) => !f.equal);
  const hasConflict = changed.some((f) => f.locked);

  if (hasConflict) {
    return (
      <span className="inline-flex items-center gap-1 text-red-600" title="מקושר למורנינג, אך יש התנגשות ח.פ/ת.ז בין המערכת למורנינג — ייתכן שקושר הלקוח הלא נכון. פתחו 'השווה למורנינג' לבדיקה.">
        <Link2 size={15} /><AlertTriangle size={12} />
      </span>
    );
  }
  if (changed.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600" title={`מקושר למורנינג, אך יש ${changed.length} פערים בין המערכת למורנינג. פתחו 'השווה למורנינג' לסנכרון.`}>
        <Link2 size={15} />
        <span className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-medium leading-none">{changed.length}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-emerald-600" title="מקושר למורנינג ומסונכרן — כל הפרטים זהים.">
      <Link2 size={15} /><CheckCircle2 size={12} />
    </span>
  );
}

// Compare a paying body against its linked Morning client and let the user sync each differing
// field in a chosen direction. taxId can only fill an empty side — a real conflict is locked.
// Shared by the list's compare modal and the inline section inside the edit form. `onSynced` lets a
// host (the form) refresh its own fields from the fresh comparison after a sync.
function MorningComparePanel({ body, onSynced }: { body: PayingBody; onSynced?: (fresh: PayingBodyMorningCompare) => void }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [compare, setCompare] = useState<PayingBodyMorningCompare | null>(null);
  const [decisions, setDecisions] = useState<Record<string, PayingBodySyncDirection>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    setDecisions({});
    comparePayingBodyMorning(body.id)
      .then((data) => { if (active) setCompare(data); })
      .catch((e: any) => { if (active) setError(e?.response?.data?.message || e?.response?.data?.error || 'טעינת ההשוואה נכשלה'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [body.id]);

  const diffs: PayingBodyFieldDiff[] = compare?.fields ?? [];
  const changed = diffs.filter((f) => !f.equal);

  const setDir = (field: PayingBodySyncField, dir: PayingBodySyncDirection | null) =>
    setDecisions((d) => {
      const next = { ...d };
      if (!dir || next[field] === dir) delete next[field];
      else next[field] = dir;
      return next;
    });

  const apply = async () => {
    if (!Object.keys(decisions).length) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const fresh = await syncPayingBodyMorning(body.id, decisions);
      setCompare(fresh);
      setDecisions({});
      setNotice('הסנכרון בוצע בהצלחה.');
      queryClient.setQueryData(['paying-body-morning-diff', body.id], fresh);
      queryClient.invalidateQueries({ queryKey: ['paying-bodies'] });
      onSynced?.(fresh);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.response?.data?.error || 'הסנכרון נכשל');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-gray-500 py-6 justify-center"><Loader2 size={18} className="animate-spin" /> טוען השוואה...</div>;
  }
  if (error && !compare) {
    return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>;
  }

  return (
    <div className="space-y-3">
      {changed.length === 0 ? (
        <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-3 text-sm">
          <CheckCircle2 size={16} /> כל הפרטים זהים בין המערכת למורנינג — אין מה לסנכרן.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-100 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="p-2 text-right font-medium text-gray-600">שדה</th>
                <th className="p-2 text-right font-medium text-gray-600">במערכת</th>
                <th className="p-2 text-right font-medium text-gray-600">במורנינג</th>
                <th className="p-2 text-center font-medium text-gray-600">פעולה</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {changed.map((f) => {
                const sel = decisions[f.field];
                const canFromMorning = f.morning !== null && !f.locked;
                const canToMorning = f.crm !== null && !f.locked;
                return (
                  <tr key={f.field} className="align-top">
                    <td className="p-2 font-medium text-gray-700 whitespace-nowrap">{SYNC_FIELD_LABEL[f.field]}</td>
                    <td className="p-2" dir="auto">{valueCell(f.crm)}</td>
                    <td className="p-2" dir="auto">{valueCell(f.morning)}</td>
                    <td className="p-2">
                      {f.locked ? (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600" title="ח.פ/ת.ז שונה בשני הצדדים — לא ניתן לדרוס. בדקו אם קושר הלקוח הנכון במורנינג.">
                          <AlertTriangle size={13} /> ערכים שונים — חסום
                        </span>
                      ) : (
                        <div className="flex flex-col gap-1 items-stretch">
                          <button
                            type="button"
                            disabled={!canFromMorning}
                            onClick={() => setDir(f.field, 'fromMorning')}
                            className={`text-xs px-2 py-1 rounded border inline-flex items-center justify-center gap-1 ${sel === 'fromMorning' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'} ${!canFromMorning ? 'opacity-40 cursor-not-allowed' : ''}`}
                            title={canFromMorning ? 'העתק את הערך ממורנינג אל המערכת' : 'אין ערך במורנינג להעתקה'}
                          >
                            <ArrowRight size={12} /> קח ממורנינג
                          </button>
                          <button
                            type="button"
                            disabled={!canToMorning}
                            onClick={() => setDir(f.field, 'toMorning')}
                            className={`text-xs px-2 py-1 rounded border inline-flex items-center justify-center gap-1 ${sel === 'toMorning' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'} ${!canToMorning ? 'opacity-40 cursor-not-allowed' : ''}`}
                            title={canToMorning ? 'דחוף את הערך מהמערכת אל מורנינג' : 'אין ערך במערכת לדחיפה'}
                          >
                            <ArrowLeft size={12} /> דחוף למורנינג
                          </button>
                          {f.field === 'taxId' && (
                            <span className="text-[10px] text-amber-700" title="ח.פ/ת.ז לעולם לא נדרס — מותר רק למלא צד ריק">מילוי צד ריק בלבד</span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {notice && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{notice}</div>}
      {error && compare && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      {changed.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={apply}
            disabled={saving || Object.keys(decisions).length === 0}
            className="btn btn-primary"
            title="החל את הכיוונים שבחרת — קודם מתעדכן מורנינג, אחר כך המערכת"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <ArrowLeftRight size={16} />} סנכרן {Object.keys(decisions).length ? `(${Object.keys(decisions).length})` : ''}
          </button>
        </div>
      )}
    </div>
  );
}

function MorningCompareModal({ body, onClose }: { body: PayingBody; onClose: () => void }) {
  return (
    <div className="p-6 space-y-4">
      <p className="text-sm text-gray-500">
        השוואת הפרטים בין הגוף המשלם במערכת לבין הלקוח המקושר במורנינג. לכל שדה שונה בחרו כיוון: למשוך ממורנינג למערכת, או לדחוף מהמערכת למורנינג.
      </p>
      <MorningComparePanel body={body} />
      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onClose} className="btn btn-secondary">סגור</button>
      </div>
    </div>
  );
}
