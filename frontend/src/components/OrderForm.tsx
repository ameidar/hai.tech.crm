import { HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SearchableSelect from './ui/SearchableSelect';
import type { InstitutionalOrderData } from '../hooks/useApi';

interface Option { value: string; label: string }

interface OrderFormProps {
  form: Partial<InstitutionalOrderData>;
  setForm: React.Dispatch<React.SetStateAction<Partial<InstitutionalOrderData>>>;
  isEdit: boolean;
  branchOptions: Option[];
  payingBodyOptions: Option[];
  formError?: string | null;
  saving?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

const lbl = (text: string, help?: string) => (
  <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
    {text}
    {help && (
      <span title={help} className="text-gray-400 hover:text-gray-600 cursor-help">
        <HelpCircle size={14} />
      </span>
    )}
  </label>
);

export default function OrderForm({
  form,
  setForm,
  isEdit,
  branchOptions,
  payingBodyOptions,
  formError,
  saving,
  onSubmit,
  onCancel,
}: OrderFormProps) {
  const navigate = useNavigate();

  return (
    <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">

      {/* Section: פרטי הזמנה */}
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1">פרטי הזמנה</div>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          {lbl('שם ההזמנה')}
          <input className="form-input w-full" value={form.orderName || ''} onChange={e => setForm(f => ({ ...f, orderName: e.target.value }))} placeholder="שם ההזמנה" />
        </div>
        <div>
          {lbl(isEdit ? 'סניף' : 'סניף *')}
          <SearchableSelect
            options={branchOptions}
            value={form.branchId || ''}
            onChange={(v) => setForm(f => ({ ...f, branchId: v }))}
            placeholder={isEdit ? 'ללא סניף' : 'בחר סניף'}
            searchPlaceholder="חפש סניף..."
          />
        </div>
        <div>
          {lbl(
            isEdit ? 'גוף משלם' : 'גוף משלם *',
            'מי שמחויב על ההזמנה — מקביל ללקוח במורנינג. החיוב יופק לפי הגוף המשלם, כך שלא נוצרות כפילויות במורנינג. חובה בהזמנה חדשה; הזמנות ישנות בלי גוף משלם ממשיכות לעבוד.',
          )}
          <SearchableSelect
            options={payingBodyOptions}
            value={form.payingBodyId || ''}
            onChange={(v) => setForm(f => ({ ...f, payingBodyId: v }))}
            placeholder={isEdit ? 'ללא גוף משלם' : 'בחר גוף משלם'}
            searchPlaceholder="חפש גוף משלם..."
          />
          <button
            type="button"
            onClick={() => navigate('/paying-bodies')}
            className="mt-1 text-xs text-blue-600 hover:text-blue-700 hover:underline"
            title="פתח את מסך הגופים המשלמים כדי ליצור גוף חדש (כולל חיפוש וקישור ללקוח קיים במורנינג)"
          >
            + צור גוף משלם חדש
          </button>
        </div>
        <div>
          {lbl('ח.פ / ת.ז עוסק')}
          <input className="form-input w-full" dir="ltr" value={form.taxId || ''} onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} placeholder="מופיע על חשבונית המוסד במורנינג" />
        </div>
        <div>
          {lbl('תנאי תשלום (ימים מסוף חודש ההנפקה)')}
          <select
            className="form-input w-full"
            value={form.paymentTermsDays ?? 30}
            onChange={e => setForm(f => ({ ...f, paymentTermsDays: Number(e.target.value) }))}
          >
            <option value={30}>שוטף + 30</option>
            <option value={45}>שוטף + 45</option>
            <option value={60}>שוטף + 60</option>
          </select>
        </div>
        <div>
          {lbl('סוג ההזמנה')}
          <select className="form-input w-full" value={form.orderType || ''} onChange={e => setForm(f => ({ ...f, orderType: e.target.value }))}>
            <option value="">—</option>
            <option value="חדשה">חדשה</option>
            <option value="אפסייל">אפסייל</option>
          </select>
        </div>
        <div>
          {lbl('מבצע')}
          <input className="form-input w-full" value={form.salesperson || ''} onChange={e => setForm(f => ({ ...f, salesperson: e.target.value }))} placeholder="שם המבצע" />
        </div>
        {form.payingBody ? (
          <div className="col-span-2">
            {lbl(
              'גוף משלם (טקסט חופשי - ישן)',
              'השדה הישן מהתקופה שלפני הגופים המשלמים. נשמר לתקופת מעבר בלבד. החיוב כבר לא מסתמך עליו — קשרו גוף משלם אמיתי בבורר שלמעלה.',
            )}
            <input
              className="form-input w-full bg-gray-50 text-gray-500"
              value={form.payingBody || ''}
              onChange={e => setForm(f => ({ ...f, payingBody: e.target.value }))}
            />
            <p className="mt-1 text-xs text-gray-400">שדה ישן לתקופת מעבר. השתמשו בבורר "גוף משלם" שלמעלה.</p>
          </div>
        ) : null}
      </div>

      {/* Section: סטטוס */}
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">סטטוס</div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          {lbl('סטטוס פנימי')}
          <select className="form-input w-full" value={form.status || 'draft'} onChange={e => setForm(f => ({ ...f, status: e.target.value as InstitutionalOrderData['status'] }))}>
            <option value="draft">טיוטה</option>
            <option value="active">פעיל</option>
            <option value="completed">הושלם</option>
            <option value="cancelled">בוטל</option>
          </select>
        </div>
        <div>
          {lbl('סטטוס Fireberry')}
          <input className="form-input w-full" value={form.fireberryStatus || ''} onChange={e => setForm(f => ({ ...f, fireberryStatus: e.target.value }))} placeholder="סיכום וסגירה / הסתיים..." />
        </div>
        <div>
          {lbl('תאריך פולואפ')}
          <input type="date" className="form-input w-full" value={form.followUpDate || ''} onChange={e => setForm(f => ({ ...f, followUpDate: e.target.value }))} />
        </div>
        <div>
          {lbl('נוצר על ידי')}
          <input className="form-input w-full" value={form.createdBy || ''} onChange={e => setForm(f => ({ ...f, createdBy: e.target.value }))} />
        </div>
      </div>

      {/* Section: איש קשר */}
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">איש קשר</div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          {lbl('שם איש קשר')}
          <input className="form-input w-full" value={form.contactName || ''} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} />
        </div>
        <div>
          {lbl('טלפון')}
          <input className="form-input w-full" dir="ltr" value={form.contactPhone || ''} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} />
        </div>
        <div className="col-span-2">
          {lbl('מייל')}
          <input type="email" className="form-input w-full" dir="ltr" value={form.contactEmail || ''} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} />
        </div>
      </div>

      {/* Section: כספים */}
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">כספים</div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          {lbl('תשלום כולל (₪)')}
          <input type="number" className="form-input w-full" value={form.totalAmount ?? ''} onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value ? Number(e.target.value) : null }))} />
        </div>
        <div>
          {lbl('מחיר לפגישה (₪)')}
          <input type="number" className="form-input w-full" value={form.pricePerMeeting ?? ''} onChange={e => setForm(f => ({ ...f, pricePerMeeting: e.target.value ? Number(e.target.value) : null }))} />
        </div>
        <div>
          {lbl('פגישות משוערות')}
          <input type="number" className="form-input w-full" value={form.estimatedMeetings ?? ''} onChange={e => setForm(f => ({ ...f, estimatedMeetings: e.target.value ? Number(e.target.value) : undefined }))} />
        </div>
        <div>
          {lbl('מספר הזמנה')}
          <input className="form-input w-full" value={form.orderNumber || ''} onChange={e => setForm(f => ({ ...f, orderNumber: e.target.value }))} placeholder="INV-001" />
        </div>
        <div>
          {lbl('תאריך התחלה')}
          <input type="date" className="form-input w-full" value={form.startDate || ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
        </div>
        <div>
          {lbl('תאריך סיום')}
          <input type="date" className="form-input w-full" value={form.endDate || ''} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
        </div>
      </div>

      {/* Section: הערות */}
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">הערות / תיאור</div>
      <textarea className="form-input w-full" rows={4} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

      {formError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{formError}</div>
      )}

      <div className="flex justify-end gap-3 pt-2 border-t">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>ביטול</button>
        <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={saving}>
          {saving ? 'שומר...' : isEdit ? 'שמור שינויים' : 'צור הזמנה'}
        </button>
      </div>
    </div>
  );
}
