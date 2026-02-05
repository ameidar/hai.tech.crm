import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, User, GraduationCap, Plus, CreditCard, BookOpen, Edit, Check } from 'lucide-react';
import { useStudents, useCycles, useCreateRegistration, useUpdateRegistration, useUpdateStudent, useCustomers } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonTable } from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ViewSelector from '../components/ViewSelector';
import type { Student, Cycle, Registration, PaymentStatus, PaymentMethod, Customer } from '../types';
import { paymentStatusHebrew } from '../types';

export default function Students() {
  const [search, setSearch] = useState('');
  const [registerStudent, setRegisterStudent] = useState<Student | null>(null);
  const [editPayment, setEditPayment] = useState<{ student: Student; registration: Registration } | null>(null);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  
  const { data: students, isLoading } = useStudents();
  const { data: cycles } = useCycles({ status: 'active' });
  const { data: customers } = useCustomers();
  const createRegistration = useCreateRegistration();
  const updateRegistration = useUpdateRegistration();
  const updateStudent = useUpdateStudent();

  const filteredStudents = students?.filter((student) =>
    student.name.toLowerCase().includes(search.toLowerCase()) ||
    student.customer?.name.toLowerCase().includes(search.toLowerCase())
  ) || [];

  // Selection handlers
  const toggleSelectAll = () => {
    if (selectedStudentIds.size === filteredStudents.length) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(filteredStudents.map(s => s.id)));
    }
  };

  const toggleSelectStudent = (id: string) => {
    const newSet = new Set(selectedStudentIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedStudentIds(newSet);
  };

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

  const handleUpdateStudent = async (data: Partial<Student>) => {
    if (!editStudent) return;
    try {
      await updateStudent.mutateAsync({
        studentId: editStudent.id,
        customerId: editStudent.customerId || '',
        data,
      });
      setEditStudent(null);
    } catch (error) {
      console.error('Failed to update student:', error);
      alert('שגיאה בעדכון התלמיד');
    }
  };

  const handleBulkUpdate = async (data: Partial<Student>) => {
    try {
      const studentsToUpdate = filteredStudents.filter(s => selectedStudentIds.has(s.id));
      const updatePromises = studentsToUpdate.map(student =>
        updateStudent.mutateAsync({ 
          studentId: student.id, 
          customerId: student.customerId || '',
          data 
        })
      );
      await Promise.all(updatePromises);
      setSelectedStudentIds(new Set());
      setShowBulkEditModal(false);
      alert(`עודכנו ${selectedStudentIds.size} תלמידים בהצלחה`);
    } catch (error) {
      console.error('Failed to bulk update students:', error);
      alert('שגיאה בעדכון גורף');
    }
  };

  // Get cycles student is not already registered to
  const getAvailableCycles = (student: Student) => {
    const registeredCycleIds = new Set(student.registrations?.map(r => r.cycleId) || []);
    return cycles?.filter(c => !registeredCycleIds.has(c.id)) || [];
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col">
        <PageHeader
          title="תלמידים"
          subtitle="טוען..."
        />
        <div className="flex-1 p-6 overflow-auto bg-gray-50">
          <div className="bg-white rounded-lg p-4 shadow mb-6">
            <div className="h-10 w-80 bg-gray-200 rounded-lg animate-pulse" />
          </div>
          <SkeletonTable rows={8} columns={5} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader
        title="תלמידים"
        subtitle={`${filteredStudents.length} תלמידים במערכת`}
      />

      <div className="flex-1 p-6 overflow-auto bg-gray-50">
        {/* Search & Views */}
        <div className="bg-white rounded-lg p-4 shadow mb-6 flex gap-4 items-center justify-between">
          <div className="flex gap-4 items-center">
            <ViewSelector entity="students" onApplyView={() => {}} />
            <div className="relative w-80">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="חיפוש לפי שם תלמיד או לקוח..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pr-10 pl-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          
          {/* Bulk Actions */}
          {selectedStudentIds.size > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">
                נבחרו {selectedStudentIds.size} תלמידים
              </span>
              <button
                onClick={() => setShowBulkEditModal(true)}
                className="btn btn-primary text-sm"
              >
                <Edit size={16} />
                עריכה גורפת
              </button>
              <button
                onClick={() => setSelectedStudentIds(new Set())}
                className="btn btn-secondary text-sm"
              >
                בטל בחירה
              </button>
            </div>
          )}
        </div>

        {/* Students List */}
        {filteredStudents.length > 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th className="w-12">
                      <input
                        type="checkbox"
                        checked={selectedStudentIds.size === filteredStudents.length && filteredStudents.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th>שם התלמיד</th>
                    <th>לקוח (הורה)</th>
                    <th>כיתה</th>
                    <th>תאריך לידה</th>
                    <th>הרשמות</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((student) => (
                    <tr key={student.id} className={`group ${selectedStudentIds.has(student.id) ? 'bg-blue-50' : ''}`}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedStudentIds.has(student.id)}
                          onChange={() => toggleSelectStudent(student.id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-blue-100 to-blue-200 rounded-full flex items-center justify-center shadow-sm group-hover:shadow transition-shadow">
                            <GraduationCap size={20} className="text-blue-600" />
                          </div>
                          <span className="font-medium text-gray-900">{student.name}</span>
                        </div>
                      </td>
                      <td>
                        {student.customer ? (
                          <Link
                            to={`/customers/${student.customer.id}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {student.customer.name}
                          </Link>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="text-gray-600">{student.grade || <span className="text-gray-400">-</span>}</td>
                      <td className="text-gray-600">
                        {student.birthDate ? new Date(student.birthDate).toLocaleDateString('he-IL') : <span className="text-gray-400">-</span>}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {student.registrations && student.registrations.length > 0 ? (
                            student.registrations.map((reg) => (
                              <button
                                key={reg.id}
                                onClick={() => setEditPayment({ student, registration: reg })}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all duration-200 border ${
                                  reg.paymentStatus === 'paid' 
                                    ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100 hover:border-green-300' 
                                    : reg.paymentStatus === 'partial' 
                                    ? 'bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100 hover:border-yellow-300' 
                                    : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 hover:border-red-300'
                                }`}
                                title={`${reg.cycle?.name || 'מחזור'} - לחץ לעדכון תשלום`}
                              >
                                <CreditCard size={12} />
                                {reg.cycle?.course?.name?.substring(0, 10) || 'מחזור'}
                              </button>
                            ))
                          ) : (
                            <span className="text-gray-400 text-sm italic">אין הרשמות</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setEditStudent(student)}
                            className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
                            title="ערוך תלמיד"
                          >
                            <Edit size={16} />
                            עריכה
                          </button>
                          <button
                            onClick={() => setRegisterStudent(student)}
                            className="inline-flex items-center gap-1.5 text-green-600 hover:text-green-700 text-sm font-medium transition-colors"
                            title="הרשם למחזור"
                          >
                            <Plus size={16} />
                            הרשמה
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<User size={40} />}
            title="לא נמצאו תלמידים"
            description={search ? `לא נמצאו תוצאות עבור "${search}"` : 'התחל להוסיף תלמידים דרך דף הלקוחות'}
          />
        )}
      </div>

      {/* Edit Student Modal */}
      <Modal
        isOpen={!!editStudent}
        onClose={() => setEditStudent(null)}
        title={`עריכת תלמיד - ${editStudent?.name || ''}`}
      >
        {editStudent && (
          <StudentEditForm
            student={editStudent}
            customers={customers || []}
            onSubmit={handleUpdateStudent}
            onCancel={() => setEditStudent(null)}
            isLoading={updateStudent.isPending}
          />
        )}
      </Modal>

      {/* Bulk Edit Modal */}
      <Modal
        isOpen={showBulkEditModal}
        onClose={() => setShowBulkEditModal(false)}
        title={`עריכה גורפת - ${selectedStudentIds.size} תלמידים`}
      >
        <StudentBulkEditForm
          selectedCount={selectedStudentIds.size}
          customers={customers || []}
          onSubmit={handleBulkUpdate}
          onCancel={() => setShowBulkEditModal(false)}
          isLoading={updateStudent.isPending}
        />
      </Modal>

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

// Student Edit Form
interface StudentEditFormProps {
  student: Student;
  customers: Customer[];
  onSubmit: (data: Partial<Student>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function StudentEditForm({ student, customers, onSubmit, onCancel, isLoading }: StudentEditFormProps) {
  const [formData, setFormData] = useState({
    name: student.name,
    birthDate: student.birthDate ? new Date(student.birthDate).toISOString().split('T')[0] : '',
    grade: student.grade || '',
    customerId: student.customerId || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: formData.name,
      birthDate: formData.birthDate || undefined,
      grade: formData.grade || undefined,
      customerId: formData.customerId || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="form-label">שם התלמיד *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="form-input"
            required
          />
        </div>

        <div>
          <label className="form-label">תאריך לידה</label>
          <input
            type="date"
            value={formData.birthDate}
            onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
            className="form-input"
          />
        </div>

        <div>
          <label className="form-label">כיתה</label>
          <input
            type="text"
            value={formData.grade}
            onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
            className="form-input"
            placeholder="לדוגמה: ז1"
          />
        </div>

        <div className="col-span-2">
          <label className="form-label">לקוח (הורה)</label>
          <select
            value={formData.customerId}
            onChange={(e) => setFormData({ ...formData, customerId: e.target.value })}
            className="form-input"
          >
            <option value="">בחר לקוח...</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name} {customer.phone ? `(${customer.phone})` : ''}
              </option>
            ))}
          </select>
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

// Student Bulk Edit Form
interface StudentBulkEditFormProps {
  selectedCount: number;
  customers: Customer[];
  onSubmit: (data: Partial<Student>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function StudentBulkEditForm({ selectedCount, customers, onSubmit, onCancel, isLoading }: StudentBulkEditFormProps) {
  const [formData, setFormData] = useState({
    grade: '',
    customerId: '',
  });
  const [updateGrade, setUpdateGrade] = useState(false);
  const [updateCustomer, setUpdateCustomer] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const data: Partial<Student> = {};
    if (updateGrade) data.grade = formData.grade || undefined;
    if (updateCustomer) data.customerId = formData.customerId || undefined;
    
    if (Object.keys(data).length === 0) {
      alert('בחר לפחות שדה אחד לעדכון');
      return;
    }
    
    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="bg-blue-50 rounded-lg p-4 mb-4">
        <p className="text-sm text-blue-700">
          <Check size={16} className="inline me-1" />
          נבחרו {selectedCount} תלמידים לעדכון
        </p>
        <p className="text-xs text-blue-600 mt-1">
          סמן את השדות שברצונך לעדכן
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="updateGrade"
            checked={updateGrade}
            onChange={(e) => setUpdateGrade(e.target.checked)}
            className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label htmlFor="updateGrade" className="form-label cursor-pointer">כיתה</label>
            <input
              type="text"
              value={formData.grade}
              onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
              className="form-input"
              placeholder="לדוגמה: ז1"
              disabled={!updateGrade}
            />
          </div>
        </div>

        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="updateCustomer"
            checked={updateCustomer}
            onChange={(e) => setUpdateCustomer(e.target.checked)}
            className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <label htmlFor="updateCustomer" className="form-label cursor-pointer">לקוח (הורה)</label>
            <select
              value={formData.customerId}
              onChange={(e) => setFormData({ ...formData, customerId: e.target.value })}
              className="form-input"
              disabled={!updateCustomer}
            >
              <option value="">בחר לקוח...</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} {customer.phone ? `(${customer.phone})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button type="submit" className="btn btn-primary" disabled={isLoading || (!updateGrade && !updateCustomer)}>
          {isLoading ? 'מעדכן...' : `עדכן ${selectedCount} תלמידים`}
        </button>
      </div>
    </form>
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
