import { useState } from 'react';
import { Plus, Wallet, Search, Edit2, Trash2, AlertTriangle, CheckCircle2, Link2, Loader2 } from 'lucide-react';
import {
  usePayingBodies,
  useCreatePayingBody,
  useUpdatePayingBody,
  useDeletePayingBody,
  searchMorningClients,
} from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCardGrid } from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal';
import type { PayingBody, MorningClientResult } from '../types';

export default function PayingBodies() {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<PayingBody | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<PayingBody | null>(null);
  const [search, setSearch] = useState('');

  const { data: bodies, isLoading } = usePayingBodies();
  const createBody = useCreatePayingBody();
  const updateBody = useUpdatePayingBody();
  const deleteBody = useDeletePayingBody();

  const list = (bodies ?? []).filter((b) => {
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
          <button onClick={() => setShowAdd(true)} className="btn btn-primary">
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
                  <th className="p-3 text-center font-medium text-gray-600">מורנינג</th>
                  <th className="p-3 text-center font-medium text-gray-600">הזמנות</th>
                  <th className="p-3 text-center font-medium text-gray-600">סטטוס</th>
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
                        <span className="inline-flex items-center gap-1 text-emerald-600" title={`מקושר ללקוח במורנינג (${b.morningClientId})`}>
                          <Link2 size={15} />
                        </span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="p-3 text-center text-gray-600">{b._count?.institutionalOrders ?? 0}</td>
                    <td className="p-3 text-center">
                      {b.isComplete ? (
                        <span className="inline-flex items-center gap-1 badge badge-success"><CheckCircle2 size={13} /> מלא</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 badge badge-warning"><AlertTriangle size={13} /> חסר השלמה</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditing(b)} className="p-1.5 hover:bg-blue-100 rounded transition-colors text-blue-600" title="עריכה"><Edit2 size={14} /></button>
                        <button onClick={() => setDeleteConfirm(b)} className="p-1.5 hover:bg-red-100 rounded transition-colors text-red-500" title="מחיקה"><Trash2 size={14} /></button>
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

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

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
      {/* Morning lookup */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-emerald-800">
            <span className="font-medium">חיפוש לקוח קיים במורנינג</span>
            <p className="text-emerald-700 text-xs mt-0.5">חפש לפי השם או הח.פ כדי להתחבר ללקוח קיים ולמנוע כפילות.</p>
          </div>
          <button type="button" onClick={handleMorningSearch} disabled={searching} className="btn btn-secondary">
            {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} חפש במורנינג
          </button>
        </div>
        {form.morningClientId && (
          <div className="mt-3 inline-flex items-center gap-1.5 text-sm text-emerald-700 bg-white border border-emerald-200 rounded px-2 py-1">
            <Link2 size={14} /> מקושר ללקוח במורנינג
            <button type="button" onClick={() => set({ morningClientId: '' })} className="text-emerald-500 hover:text-red-500 ms-1" title="נתק">✕</button>
          </div>
        )}
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
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="form-label">שם הגוף המשלם *</label>
          <input type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} className="form-input" required />
        </div>
        <div>
          <label className="form-label">ח.פ / ת.ז *</label>
          <input type="text" value={form.taxId} onChange={(e) => set({ taxId: e.target.value })} className="form-input" dir="ltr" required />
        </div>
        <div>
          <label className="form-label">איש קשר *</label>
          <input type="text" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} className="form-input" required />
        </div>
        <div>
          <label className="form-label">מייל *</label>
          <input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} className="form-input" dir="ltr" required />
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
