import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, User, GraduationCap, Plus, CreditCard, BookOpen } from 'lucide-react';
import { useStudents, useCycles, useCreateRegistration, useUpdateRegistration } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ViewSelector from '../components/ViewSelector';
import type { Student, Cycle, Registration, PaymentStatus, PaymentMethod } from '../types';
import { paymentStatusHebrew } from '../types';

export default function Students() {
  const [search, setSearch] = useState('');
  const [registerStudent, setRegisterStudent] = useState<Student | null>(null);
  const [editPayment, setEditPayment] = useState<{ student: Student; registration: Registration } | null>(null);
  
  const { data: students, isLoading } = useStudents();
  const { data: cycles } = useCycles({ status: 'active' });
  const createRegistration = useCreateRegistration();
  const updateRegistration = useUpdateRegistration();

  const filteredStudents = students?.filter((student) =>
    student.name.toLowerCase().includes(search.toLowerCase()) ||
    student.customer?.name.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleRegister = async (cycleId: string, paymentData: { amount?: number; paymentStatus?: PaymentStatus; paymentMethod?: PaymentMethod }) => {
    if (!registerStudent) return;
    try {
      await createRegistration.mutateAsync({
        cycleId,
        data: {
          studentId: registerStudent.id,
          status: 'active',
          registrationDate: new Date().toISOString().split('T')[0],
          ...paymentData,
        },
      });
      setRegisterStudent(null);
    } catch (error) {
      console.error('Failed to register:', error);
      alert('שגיאה בהרשמת התלמיד');
    }
  };

  const handleUpdatePayment = async (data: Partial<Registration>) => {
    if (!editPayment) return;
    try {
      await updateRegistration.mutateAsync({
        registrationId: editPayment.registration.id,
        cycleId: editPayment.registration.cycleId,
        data,
      });
      setEditPayment(null);
    } catch (error) {
      console.error('Failed to update payment:', error);
      alert('שגיאה בעדכון התשלום');
    }
  };

  // Get cycles student is not already registered to
  const getAvailableCycles = (student: Student) => {
    const registeredCycleIds = new Set(student.registrations?.map(r => r.cycleId) || []);
    return cycles?.filter(c => !registeredCycleIds.has(c.id)) || [];
  };

  if (isLoading) {
    return <Loading size="lg" text="טוען תלמידים..." />;
  }

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader
        title="תלמידים"
        subtitle={`${filteredStudents.length} תלמידים במערכת`}
      />

      <div className="flex-1 p-6 overflow-auto bg-gray-50">
        {/* Search & Views */}
        <div className="bg-white rounded-lg p-4 shadow mb-6 flex gap-4 items-center">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="חיפוש לפי שם תלמיד או לקוח..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pr-10 pl-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <ViewSelector entity="students" onApplyView={() => {}} />
        </div>

        {/* Students List */}
        {filteredStudents.length > 0 ? (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">שם התלמיד</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">לקוח (הורה)</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">כיתה</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">הרשמות</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredStudents.map((student) => (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <GraduationCap size={20} className="text-blue-600" />
                        </div>
                        <span className="font-medium text-gray-900">{student.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {student.customer ? (
                        <Link
                          to={`/customers/${student.customer.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {student.customer.name}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{student.grade || '-'}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {student.registrations && student.registrations.length > 0 ? (
                          student.registrations.map((reg) => (
                            <button
                              key={reg.id}
                              onClick={() => setEditPayment({ student, registration: reg })}
                              className={`px-2 py-1 rounded-full text-xs flex items-center gap-1 transition-colors ${
                                reg.paymentStatus === 'paid' ? 'bg-green-100 text-green-700 hover:bg-green-200' :
                                reg.paymentStatus === 'partial' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' :
                                'bg-red-100 text-red-700 hover:bg-red-200'
                              }`}
                              title={`${reg.cycle?.name || 'מחזור'} - לחץ לעדכון תשלום`}
                            >
                              <CreditCard size={12} />
                              {reg.cycle?.course?.name?.substring(0, 10) || 'מחזור'}
                            </button>
                          ))
                        ) : (
                          <span className="text-gray-400 text-sm">אין הרשמות</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setRegisterStudent(student)}
                          className="text-green-600 hover:text-green-700 flex items-center gap-1 text-sm"
                          title="הרשם למחזור"
                        >
                          <Plus size={16} />
                          הרשמה
                        </button>
                        <Link
                          to={`/customers/${student.customerId}`}
                          className="text-blue-600 hover:underline text-sm"
                        >
                          פרטים
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<User size={48} className="text-gray-300" />}
            title="לא נמצאו תלמידים"
            description={search ? 'נסה לחפש במונחים אחרים' : 'התחל להוסיף תלמידים דרך דף הלקוחות'}
          />
        )}
      </div>

      {/* Register to Cycle Modal */}
      <Modal
        isOpen={!!registerStudent}
        onClose={() => setRegisterStudent(null)}
        title={`הרשמה למחזור - ${registerStudent?.name || ''}`}
        size="lg"
      >
        {registerStudent && (
          <RegisterToCycleForm
            student={registerStudent}
            availableCycles={getAvailableCycles(registerStudent)}
            onRegister={handleRegister}
            onCancel={() => setRegisterStudent(null)}
            isLoading={createRegistration.isPending}
          />
        )}
      </Modal>

      {/* Edit Payment Modal */}
      <Modal
        isOpen={!!editPayment}
        onClose={() => setEditPayment(null)}
        title={`עדכון תשלום - ${editPayment?.student.name || ''}`}
      >
        {editPayment && (
          <PaymentEditForm
            registration={editPayment.registration}
            onSubmit={handleUpdatePayment}
            onCancel={() => setEditPayment(null)}
            isLoading={updateRegistration.isPending}
          />
        )}
      </Modal>
    </div>
  );
}

// Register to Cycle Form
interface RegisterToCycleFormProps {
  student: Student;
  availableCycles: Cycle[];
  onRegister: (cycleId: string, paymentData: { amount?: number; paymentStatus?: PaymentStatus; paymentMethod?: PaymentMethod }) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function RegisterToCycleForm({ student, availableCycles, onRegister, onCancel, isLoading }: RegisterToCycleFormProps) {
  const [selectedCycle, setSelectedCycle] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCycle) return;
    
    onRegister(selectedCycle, {
      amount: amount ? Number(amount) : undefined,
      paymentStatus,
      paymentMethod: paymentMethod || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="bg-blue-50 rounded-lg p-4 mb-4">
        <p className="text-sm text-blue-600">
          <GraduationCap size={16} className="inline me-1" />
          {student.name} • {student.customer?.name}
        </p>
      </div>

      <div>
        <label className="form-label">בחר מחזור *</label>
        {availableCycles.length > 0 ? (
          <select
            value={selectedCycle}
            onChange={(e) => setSelectedCycle(e.target.value)}
            className="form-input"
            required
          >
            <option value="">בחר מחזור...</option>
            {availableCycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name} - {cycle.course?.name} ({cycle.branch?.name})
              </option>
            ))}
          </select>
        ) : (
          <p className="text-gray-500 text-sm p-3 bg-gray-50 rounded-lg">
            <BookOpen size={16} className="inline me-1" />
            התלמיד רשום לכל המחזורים הפעילים או שאין מחזורים פעילים
          </p>
        )}
      </div>

      {availableCycles.length > 0 && (
        <>
          <div className="border-t pt-4">
            <h4 className="font-medium text-gray-700 mb-3">פרטי תשלום</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">סכום לתשלום (₪)</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
                  className="form-input"
                  min="0"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="form-label">סטטוס תשלום</label>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
                  className="form-input"
                >
                  <option value="unpaid">לא שולם</option>
                  <option value="partial">שולם חלקית</option>
                  <option value="paid">שולם במלואו</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="form-label">אמצעי תשלום</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}
                  className="form-input"
                >
                  <option value="">בחר...</option>
                  <option value="credit">אשראי</option>
                  <option value="transfer">העברה בנקאית</option>
                  <option value="cash">מזומן</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={onCancel} className="btn btn-secondary">
              ביטול
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoading || !selectedCycle}
            >
              {isLoading ? 'רושם...' : 'הרשם למחזור'}
            </button>
          </div>
        </>
      )}

      {availableCycles.length === 0 && (
        <div className="flex justify-end pt-4 border-t">
          <button type="button" onClick={onCancel} className="btn btn-secondary">
            סגור
          </button>
        </div>
      )}
    </form>
  );
}

// Payment Edit Form
interface PaymentEditFormProps {
  registration: Registration;
  onSubmit: (data: Partial<Registration>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function PaymentEditForm({ registration, onSubmit, onCancel, isLoading }: PaymentEditFormProps) {
  const [formData, setFormData] = useState({
    amount: registration.amount || 0,
    paymentStatus: registration.paymentStatus || 'unpaid',
    paymentMethod: registration.paymentMethod || '',
    invoiceLink: registration.invoiceLink || '',
    notes: registration.notes || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      amount: formData.amount || undefined,
      paymentStatus: formData.paymentStatus as PaymentStatus,
      paymentMethod: formData.paymentMethod as PaymentMethod || undefined,
      invoiceLink: formData.invoiceLink || undefined,
      notes: formData.notes || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="bg-gray-50 rounded-lg p-3 mb-4">
        <p className="text-sm text-gray-600">
          מחזור: <span className="font-medium">{registration.cycle?.name || 'לא ידוע'}</span>
        </p>
        <p className="text-xs text-gray-500">
          {registration.cycle?.course?.name} • {registration.cycle?.branch?.name}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">סכום לתשלום (₪)</label>
          <input
            type="number"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
            className="form-input"
            min="0"
          />
        </div>

        <div>
          <label className="form-label">סטטוס תשלום</label>
          <select
            value={formData.paymentStatus}
            onChange={(e) => setFormData({ ...formData, paymentStatus: e.target.value as PaymentStatus })}
            className="form-input"
          >
            <option value="unpaid">לא שולם</option>
            <option value="partial">שולם חלקית</option>
            <option value="paid">שולם במלואו</option>
          </select>
        </div>

        <div>
          <label className="form-label">אמצעי תשלום</label>
          <select
            value={formData.paymentMethod}
            onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
            className="form-input"
          >
            <option value="">בחר...</option>
            <option value="credit">אשראי</option>
            <option value="transfer">העברה בנקאית</option>
            <option value="cash">מזומן</option>
          </select>
        </div>

        <div>
          <label className="form-label">קישור לחשבונית</label>
          <input
            type="url"
            value={formData.invoiceLink}
            onChange={(e) => setFormData({ ...formData, invoiceLink: e.target.value })}
            className="form-input"
            dir="ltr"
            placeholder="https://..."
          />
        </div>

        <div className="col-span-2">
          <label className="form-label">הערות</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="form-input"
            rows={2}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button type="submit" className="btn btn-primary" disabled={isLoading}>
          {isLoading ? 'שומר...' : 'שמור'}
        </button>
      </div>
    </form>
  );
}
