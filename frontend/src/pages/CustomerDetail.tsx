import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight, Phone, Mail, MapPin, Plus, Edit, User, Trash2, BookOpen } from 'lucide-react';
import { useCustomer, useStudents, useCreateStudent, useUpdateCustomer, useUpdateStudent, useDeleteStudent, useCycles, useCreateRegistration } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';
import type { Customer, Student, Cycle, PaymentStatus, PaymentMethod } from '../types';

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);

  const { data: customer, isLoading } = useCustomer(id!);
  const { data: students } = useStudents(id);
  const { data: cycles } = useCycles({ status: 'active' });
  const createStudent = useCreateStudent();
  const createRegistration = useCreateRegistration();
  const updateCustomer = useUpdateCustomer();
  const updateStudent = useUpdateStudent();
  const deleteStudent = useDeleteStudent();

  const handleDeleteStudent = async (studentId: string, studentName: string) => {
    if (window.confirm(`האם למחוק את התלמיד "${studentName}"?`)) {
      try {
        await deleteStudent.mutateAsync({ studentId, customerId: id! });
      } catch (error) {
        console.error('Failed to delete student:', error);
      }
    }
  };

  const handleEditStudent = (student: Student) => {
    setEditingStudent(student);
  };

  const handleUpdateStudent = async (data: Partial<Student>) => {
    if (!editingStudent) return;
    try {
      await updateStudent.mutateAsync({ studentId: editingStudent.id, customerId: id!, data });
      setEditingStudent(null);
    } catch (error) {
      console.error('Failed to update student:', error);
    }
  };

  const handleAddStudent = async (
    studentData: Partial<Student>,
    cycleData?: { cycleId: string; amount?: number; paymentStatus?: PaymentStatus; paymentMethod?: PaymentMethod }
  ) => {
    try {
      const student = await createStudent.mutateAsync({ customerId: id!, data: studentData });
      
      // If cycle registration is requested
      if (cycleData?.cycleId && student) {
        await createRegistration.mutateAsync({
          cycleId: cycleData.cycleId,
          data: {
            studentId: student.id,
            status: 'active',
            registrationDate: new Date().toISOString().split('T')[0],
            amount: cycleData.amount,
            paymentStatus: cycleData.paymentStatus,
            paymentMethod: cycleData.paymentMethod,
          },
        });
      }
      
      setShowAddStudentModal(false);
    } catch (error) {
      console.error('Failed to create student:', error);
      alert('שגיאה ביצירת התלמיד');
    }
  };

  const handleUpdateCustomer = async (data: Partial<Customer>) => {
    try {
      await updateCustomer.mutateAsync({ id: id!, data });
      setShowEditModal(false);
    } catch (error) {
      console.error('Failed to update customer:', error);
    }
  };

  if (isLoading) {
    return <Loading size="lg" text="טוען פרטי לקוח..." />;
  }

  if (!customer) {
    return (
      <EmptyState
        title="לקוח לא נמצא"
        description="הלקוח המבוקש לא נמצא במערכת"
        action={
          <Link to="/customers" className="btn btn-primary">
            חזרה לרשימת לקוחות
          </Link>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={customer.name}
        actions={
          <div className="flex gap-3">
            <Link to="/customers" className="btn btn-secondary">
              <ArrowRight size={18} />
              חזרה
            </Link>
            <button onClick={() => setShowEditModal(true)} className="btn btn-primary">
              <Edit size={18} />
              עריכה
            </button>
          </div>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Customer Info */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">פרטי לקוח</h2>
            </div>
            <div className="card-body space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Phone size={18} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">טלפון</p>
                  <p className="font-medium" dir="ltr">{customer.phone}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Mail size={18} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">אימייל</p>
                  <p className="font-medium" dir="ltr">{customer.email}</p>
                </div>
              </div>

              {customer.address && (
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <MapPin size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">כתובת</p>
                    <p className="font-medium">
                      {customer.address}
                      {customer.city && `, ${customer.city}`}
                    </p>
                  </div>
                </div>
              )}

              {customer.notes && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-gray-500 mb-1">הערות</p>
                  <p className="text-gray-700">{customer.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Students */}
          <div className="lg:col-span-2 card">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold">תלמידים ({students?.length || 0})</h2>
              <button
                onClick={() => setShowAddStudentModal(true)}
                className="btn btn-primary text-sm"
              >
                <Plus size={16} />
                הוסף תלמיד
              </button>
            </div>

            {students && students.length > 0 ? (
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>שם</th>
                      <th>תאריך לידה</th>
                      <th>כיתה</th>
                      <th>הערות</th>
                      <th>פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student) => (
                      <tr key={student.id}>
                        <td className="font-medium">{student.name}</td>
                        <td>
                          {student.birthDate
                            ? new Date(student.birthDate).toLocaleDateString('he-IL')
                            : '-'}
                        </td>
                        <td>{student.grade || '-'}</td>
                        <td className="text-gray-500">{student.notes || '-'}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleEditStudent(student)}
                              className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                              title="ערוך תלמיד"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteStudent(student.id, student.name)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              title="מחק תלמיד"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center">
                <User size={48} className="mx-auto mb-4 text-gray-300" />
                <p className="text-gray-500">אין תלמידים רשומים</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Student Modal */}
      <Modal
        isOpen={showAddStudentModal}
        onClose={() => setShowAddStudentModal(false)}
        title="תלמיד חדש"
        size="lg"
      >
        <StudentForm
          cycles={cycles || []}
          onSubmit={handleAddStudent}
          onCancel={() => setShowAddStudentModal(false)}
          isLoading={createStudent.isPending || createRegistration.isPending}
        />
      </Modal>

      {/* Edit Customer Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="עריכת לקוח"
      >
        <CustomerEditForm
          customer={customer}
          onSubmit={handleUpdateCustomer}
          onCancel={() => setShowEditModal(false)}
          isLoading={updateCustomer.isPending}
        />
      </Modal>

      {/* Edit Student Modal */}
      <Modal
        isOpen={!!editingStudent}
        onClose={() => setEditingStudent(null)}
        title="עריכת תלמיד"
      >
        {editingStudent && (
          <StudentEditForm
            student={editingStudent}
            onSubmit={handleUpdateStudent}
            onCancel={() => setEditingStudent(null)}
            isLoading={updateStudent.isPending}
          />
        )}
      </Modal>
    </>
  );
}

// Student Form
interface StudentFormProps {
  cycles: Cycle[];
  onSubmit: (
    studentData: Partial<Student>,
    cycleData?: { cycleId: string; amount?: number; paymentStatus?: PaymentStatus; paymentMethod?: PaymentMethod }
  ) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function StudentForm({ cycles, onSubmit, onCancel, isLoading }: StudentFormProps) {
  const [formData, setFormData] = useState({
    name: '',
    birthDate: '',
    grade: '',
    notes: '',
  });
  
  const [registerToCycle, setRegisterToCycle] = useState(false);
  const [cycleData, setCycleData] = useState({
    cycleId: '',
    amount: '' as number | '',
    paymentStatus: 'unpaid' as PaymentStatus,
    paymentMethod: '' as PaymentMethod | '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const studentData = {
      ...formData,
      birthDate: formData.birthDate || undefined,
    };
    
    if (registerToCycle && cycleData.cycleId) {
      onSubmit(studentData, {
        cycleId: cycleData.cycleId,
        amount: cycleData.amount ? Number(cycleData.amount) : undefined,
        paymentStatus: cycleData.paymentStatus,
        paymentMethod: cycleData.paymentMethod || undefined,
      });
    } else {
      onSubmit(studentData);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      {/* Student Details */}
      <div>
        <label className="form-label">שם התלמיד *</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="form-input"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
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
            placeholder="לדוגמה: ה'"
          />
        </div>
      </div>

      <div>
        <label className="form-label">הערות</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="form-input"
          rows={2}
        />
      </div>

      {/* Cycle Registration Section */}
      <div className="border-t pt-4">
        <div className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            id="registerToCycle"
            checked={registerToCycle}
            onChange={(e) => setRegisterToCycle(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="registerToCycle" className="text-sm font-medium text-gray-700 flex items-center gap-1">
            <BookOpen size={16} />
            הרשם למחזור
          </label>
        </div>

        {registerToCycle && (
          <div className="bg-blue-50 rounded-lg p-4 space-y-4">
            <div>
              <label className="form-label">בחר מחזור *</label>
              <select
                value={cycleData.cycleId}
                onChange={(e) => setCycleData({ ...cycleData, cycleId: e.target.value })}
                className="form-input"
                required={registerToCycle}
              >
                <option value="">בחר מחזור...</option>
                {cycles.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.name} - {cycle.course?.name} ({cycle.branch?.name})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="form-label text-xs">סכום (₪)</label>
                <input
                  type="number"
                  value={cycleData.amount}
                  onChange={(e) => setCycleData({ ...cycleData, amount: e.target.value ? Number(e.target.value) : '' })}
                  className="form-input text-sm"
                  min="0"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="form-label text-xs">סטטוס תשלום</label>
                <select
                  value={cycleData.paymentStatus}
                  onChange={(e) => setCycleData({ ...cycleData, paymentStatus: e.target.value as PaymentStatus })}
                  className="form-input text-sm"
                >
                  <option value="unpaid">לא שולם</option>
                  <option value="partial">חלקי</option>
                  <option value="paid">שולם</option>
                </select>
              </div>

              <div>
                <label className="form-label text-xs">אמצעי תשלום</label>
                <select
                  value={cycleData.paymentMethod}
                  onChange={(e) => setCycleData({ ...cycleData, paymentMethod: e.target.value as PaymentMethod | '' })}
                  className="form-input text-sm"
                >
                  <option value="">בחר...</option>
                  <option value="credit">אשראי</option>
                  <option value="transfer">העברה</option>
                  <option value="cash">מזומן</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button type="submit" className="btn btn-primary" disabled={isLoading}>
          {isLoading ? 'שומר...' : registerToCycle ? 'שמור והרשם למחזור' : 'שמור'}
        </button>
      </div>
    </form>
  );
}

// Customer Edit Form
interface CustomerEditFormProps {
  customer: Customer;
  onSubmit: (data: Partial<Customer>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function CustomerEditForm({ customer, onSubmit, onCancel, isLoading }: CustomerEditFormProps) {
  const [formData, setFormData] = useState({
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address: customer.address || '',
    city: customer.city || '',
    notes: customer.notes || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="form-label">שם *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="form-input"
            required
          />
        </div>

        <div>
          <label className="form-label">טלפון *</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className="form-input"
            dir="ltr"
            required
          />
        </div>

        <div>
          <label className="form-label">אימייל *</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="form-input"
            dir="ltr"
            required
          />
        </div>

        <div>
          <label className="form-label">כתובת</label>
          <input
            type="text"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            className="form-input"
          />
        </div>

        <div>
          <label className="form-label">עיר</label>
          <input
            type="text"
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            className="form-input"
          />
        </div>

        <div className="col-span-2">
          <label className="form-label">הערות</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="form-input"
            rows={3}
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

// Student Edit Form
interface StudentEditFormProps {
  student: Student;
  onSubmit: (data: Partial<Student>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function StudentEditForm({ student, onSubmit, onCancel, isLoading }: StudentEditFormProps) {
  const [formData, setFormData] = useState({
    name: student.name,
    birthDate: student.birthDate ? student.birthDate.split('T')[0] : '',
    grade: student.grade || '',
    notes: student.notes || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      birthDate: formData.birthDate || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div>
        <label className="form-label">שם התלמיד *</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="form-input"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
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
            placeholder="לדוגמה: ה'"
          />
        </div>
      </div>

      <div>
        <label className="form-label">הערות</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="form-input"
          rows={3}
        />
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
