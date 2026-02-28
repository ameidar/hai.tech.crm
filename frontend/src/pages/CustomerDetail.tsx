import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Phone, Mail, MapPin, Plus, Edit, Pencil, User, Trash2, BookOpen, MessageCircle, Send, ExternalLink, Clock, CreditCard, FileText } from 'lucide-react';
import { useCustomer, useStudents, useCreateStudent, useUpdateCustomer, useUpdateStudent, useDeleteStudent, useDeleteCustomer, useCycles, useCreateRegistration, useSendWhatsApp, useSendEmail, useCourses, useBranches, useInstructors, useCreateCycle } from '../hooks/useApi';
import api from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';
import WooPayModal from '../components/WooPayModal';
import type { Customer, Student, Cycle, PaymentStatus, PaymentMethod } from '../types';

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);

  const { data: customer, isLoading } = useCustomer(id!);
  const { data: students } = useStudents(id);
  const { data: cycles, refetch: refetchCycles } = useCycles({ status: 'active' });
  const createStudent = useCreateStudent();
  const sendWhatsApp = useSendWhatsApp();
  const sendEmail = useSendEmail();
  const createRegistration = useCreateRegistration();
  const updateCustomer = useUpdateCustomer();
  const updateStudent = useUpdateStudent();
  const deleteStudent = useDeleteStudent();
  const deleteCustomer = useDeleteCustomer();

  const handleDeleteCustomer = async () => {
    if (!customer) return;
    if (window.confirm(`האם למחוק את הלקוח "${customer.name}"?\n\nפעולה זו תמחק גם את כל התלמידים המשויכים.`)) {
      try {
        await deleteCustomer.mutateAsync(id!);
        navigate('/customers');
      } catch (error) {
        console.error('Failed to delete customer:', error);
        alert('שגיאה במחיקת הלקוח');
      }
    }
  };

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

  const handleUpdateStudent = async (
    data: Partial<Student>,
    cycleData?: { cycleId: string; amount?: number; paymentStatus?: PaymentStatus; paymentMethod?: PaymentMethod }
  ) => {
    if (!editingStudent) return;
    try {
      await updateStudent.mutateAsync({ studentId: editingStudent.id, customerId: id!, data });
      
      // If cycle registration is requested
      if (cycleData?.cycleId) {
        await createRegistration.mutateAsync({
          cycleId: cycleData.cycleId,
          data: {
            studentId: editingStudent.id,
            status: 'active',
            registrationDate: new Date().toISOString().split('T')[0],
            amount: cycleData.amount,
            paymentStatus: cycleData.paymentStatus,
            paymentMethod: cycleData.paymentMethod,
          },
        });
      }
      
      setEditingStudent(null);
    } catch (error) {
      console.error('Failed to update student:', error);
      alert('שגיאה בעדכון התלמיד');
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
            <button onClick={handleDeleteCustomer} className="btn btn-danger">
              <Trash2 size={18} />
              מחיקה
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <Phone size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">טלפון</p>
                    <p className="font-medium" dir="ltr">{customer.phone}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`tel:${customer.phone}`}
                    className="p-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                    title="התקשר"
                  >
                    <Phone size={16} className="text-blue-600" />
                  </a>
                  <button
                    onClick={() => setShowWhatsAppModal(true)}
                    className="p-2 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                    title="שלח הודעת וואטסאפ"
                  >
                    <MessageCircle size={16} className="text-green-600" />
                  </button>
                  <button
                    onClick={() => setShowPayModal(true)}
                    className="p-2 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                    title="שלח לינק תשלום"
                  >
                    <CreditCard size={16} className="text-purple-600" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <Mail size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">אימייל</p>
                    <p className="font-medium" dir="ltr">{customer.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowEmailModal(true)}
                  className="p-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                  title="שלח אימייל"
                >
                  <Send size={16} className="text-blue-600" />
                </button>
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

              {(customer.lmsUsername || customer.lmsPassword) && (
                <div className="pt-4 border-t">
                  <p className="text-sm font-semibold text-indigo-600 mb-2">🎓 פרטי כניסה לקורסים דיגיטליים</p>
                  <div className="bg-indigo-50 rounded-lg p-3 space-y-1 text-sm" dir="ltr">
                    {customer.lmsUsername && (
                      <div className="flex gap-2">
                        <span className="text-gray-500">User:</span>
                        <span className="font-mono font-medium">{customer.lmsUsername}</span>
                      </div>
                    )}
                    {customer.lmsPassword && (
                      <div className="flex gap-2">
                        <span className="text-gray-500">Pass:</span>
                        <span className="font-mono font-medium">{customer.lmsPassword}</span>
                      </div>
                    )}
                  </div>
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
                      <th>מחזור</th>
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
                        <td>
                          {student.registrations && student.registrations.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {student.registrations.map((reg: any) => (
                                <Link
                                  key={reg.id}
                                  to={`/cycles/${reg.cycle?.id}`}
                                  className="text-blue-600 hover:text-blue-800 hover:underline text-sm"
                                >
                                  {reg.cycle?.name || 'מחזור'}
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
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

          {/* Communication History */}
          <CommunicationHistory customerId={customer.id} />

          {/* Payment History */}
          <PaymentHistory customerId={customer.id} />
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
          onCycleCreated={() => refetchCycles()}
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
            cycles={cycles || []}
            onSubmit={handleUpdateStudent}
            onCancel={() => setEditingStudent(null)}
            isLoading={updateStudent.isPending || createRegistration.isPending}
            onCycleCreated={() => refetchCycles()}
          />
        )}
      </Modal>

      {/* WhatsApp Modal */}
      <Modal
        isOpen={showWhatsAppModal}
        onClose={() => setShowWhatsAppModal(false)}
        title="שליחת הודעת וואטסאפ"
      >
        <WhatsAppForm
          phone={customer.phone}
          customerName={customer.name}
          onSubmit={async (message) => {
            try {
              await sendWhatsApp.mutateAsync({ 
                phone: customer.phone, 
                message,
                customerId: customer.id,
                customerName: customer.name,
              });
              setShowWhatsAppModal(false);
              alert('ההודעה נשלחה בהצלחה!');
            } catch (error) {
              console.error('Failed to send WhatsApp:', error);
              alert('שגיאה בשליחת ההודעה');
            }
          }}
          onCancel={() => setShowWhatsAppModal(false)}
          isLoading={sendWhatsApp.isPending}
        />
      </Modal>

      {/* Email Modal */}
      <Modal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        title="שליחת אימייל"
        size="lg"
      >
        <EmailForm
          email={customer.email}
          customerName={customer.name}
          onSubmit={async (subject, body) => {
            try {
              await sendEmail.mutateAsync({ 
                to: customer.email, 
                subject, 
                body,
                customerId: customer.id,
                customerName: customer.name,
              });
              setShowEmailModal(false);
              alert('האימייל נשלח בהצלחה!');
            } catch (error) {
              console.error('Failed to send email:', error);
              alert('שגיאה בשליחת האימייל');
            }
          }}
          onCancel={() => setShowEmailModal(false)}
          isLoading={sendEmail.isPending}
        />
      </Modal>

      {showPayModal && (
        <WooPayModal
          onClose={() => setShowPayModal(false)}
          customerId={customer.id}
          customerName={customer.name}
          customerPhone={customer.phone}
          customerEmail={customer.email || undefined}
        />
      )}
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
  onCycleCreated?: () => void;
}

function StudentForm({ cycles, onSubmit, onCancel, isLoading, onCycleCreated }: StudentFormProps) {
  const [formData, setFormData] = useState({
    name: '',
    birthDate: '',
    grade: '',
    notes: '',
  });
  
  const [registerToCycle, setRegisterToCycle] = useState(false);
  const [cycleSearch, setCycleSearch] = useState('');
  const [showCycleDropdown, setShowCycleDropdown] = useState(false);
  const [showNewCycleModal, setShowNewCycleModal] = useState(false);
  const [cycleData, setCycleData] = useState({
    cycleId: '',
    cycleName: '',
    amount: '' as number | '',
    paymentStatus: 'unpaid' as PaymentStatus,
    paymentMethod: '' as PaymentMethod | '',
  });

  // Filter cycles based on search
  const filteredCycles = cycles.filter((cycle) => {
    if (!cycleSearch) return true;
    const searchLower = cycleSearch.toLowerCase();
    return (
      cycle.name.toLowerCase().includes(searchLower) ||
      cycle.course?.name?.toLowerCase().includes(searchLower) ||
      cycle.branch?.name?.toLowerCase().includes(searchLower) ||
      cycle.instructor?.name?.toLowerCase().includes(searchLower)
    );
  });

  const handleSelectCycle = (cycle: Cycle) => {
    setCycleData({
      ...cycleData,
      cycleId: cycle.id,
      cycleName: `${cycle.name} - ${cycle.course?.name} (${cycle.branch?.name})`,
    });
    setCycleSearch('');
    setShowCycleDropdown(false);
  };

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
    <>
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
                <div className="relative">
                  {cycleData.cycleId ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 form-input bg-white flex items-center justify-between">
                        <span className="text-sm">{cycleData.cycleName}</span>
                        <button
                          type="button"
                          onClick={() => setCycleData({ ...cycleData, cycleId: '', cycleName: '' })}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <input
                          type="text"
                          value={cycleSearch}
                          onChange={(e) => {
                            setCycleSearch(e.target.value);
                            setShowCycleDropdown(true);
                          }}
                          onFocus={() => setShowCycleDropdown(true)}
                          onBlur={() => setTimeout(() => setShowCycleDropdown(false), 200)}
                          placeholder="חפש מחזור לפי שם, קורס, סניף או מדריך..."
                          className="form-input"
                        />
                        {showCycleDropdown && (
                          <button
                            type="button"
                            onClick={() => setShowCycleDropdown(false)}
                            className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {showCycleDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-auto">
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setShowCycleDropdown(false);
                              setShowNewCycleModal(true);
                            }}
                            className="w-full px-3 py-2 text-right bg-green-50 hover:bg-green-100 text-green-700 font-medium text-sm flex items-center gap-2 sticky top-0 border-b border-green-200"
                          >
                            <Plus size={16} />
                            צור מחזור חדש
                          </button>
                          {filteredCycles.length > 0 ? (
                            filteredCycles.map((cycle) => (
                              <button
                                key={cycle.id}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => handleSelectCycle(cycle)}
                                className="w-full px-3 py-2 text-right hover:bg-blue-50 border-b border-gray-100 last:border-0"
                              >
                                <div className="font-medium text-sm">{cycle.name}</div>
                                <div className="text-xs text-gray-500">
                                  {cycle.course?.name} • {cycle.branch?.name} • {cycle.instructor?.name}
                                </div>
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-sm text-gray-500 text-center">
                              לא נמצאו מחזורים
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
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

      {/* New Cycle Modal */}
      {showNewCycleModal && (
        <QuickCycleForm
          onClose={() => setShowNewCycleModal(false)}
          onCreated={(newCycle) => {
            handleSelectCycle(newCycle);
            setShowNewCycleModal(false);
            if (onCycleCreated) onCycleCreated();
          }}
        />
      )}
    </>
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
    lmsUsername: customer.lmsUsername || '',
    lmsPassword: customer.lmsPassword || '',
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

        {/* LMS Credentials */}
        <div className="col-span-2 border-t pt-3">
          <p className="text-sm font-semibold text-gray-600 mb-2">🎓 פרטי כניסה לקורסים דיגיטליים</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">שם משתמש (LMS)</label>
              <input
                type="text"
                value={formData.lmsUsername}
                onChange={(e) => setFormData({ ...formData, lmsUsername: e.target.value })}
                className="form-input"
                dir="ltr"
                placeholder="username"
              />
            </div>
            <div>
              <label className="form-label">סיסמה (LMS)</label>
              <input
                type="text"
                value={formData.lmsPassword}
                onChange={(e) => setFormData({ ...formData, lmsPassword: e.target.value })}
                className="form-input"
                dir="ltr"
                placeholder="password"
              />
            </div>
          </div>
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
  cycles: Cycle[];
  onSubmit: (data: Partial<Student>, cycleData?: { cycleId: string; amount?: number; paymentStatus?: PaymentStatus; paymentMethod?: PaymentMethod }) => void;
  onCancel: () => void;
  isLoading?: boolean;
  onCycleCreated?: () => void;
}

function StudentEditForm({ student, cycles, onSubmit, onCancel, isLoading, onCycleCreated }: StudentEditFormProps) {
  const [formData, setFormData] = useState({
    name: student.name,
    birthDate: student.birthDate ? student.birthDate.split('T')[0] : '',
    grade: student.grade || '',
    notes: student.notes || '',
  });

  const [addToCycle, setAddToCycle] = useState(false);
  const [cycleSearch, setCycleSearch] = useState('');
  const [showCycleDropdown, setShowCycleDropdown] = useState(false);
  const [showNewCycleModal, setShowNewCycleModal] = useState(false);
  const [cycleData, setCycleData] = useState({
    cycleId: '',
    cycleName: '',
    amount: '' as number | '',
    paymentStatus: 'unpaid' as PaymentStatus,
    paymentMethod: '' as PaymentMethod | '',
  });

  // Get existing registration cycle IDs
  const existingCycleIds = new Set(student.registrations?.map(r => r.cycleId) || []);

  // Filter cycles based on search and exclude already registered
  const filteredCycles = cycles.filter((cycle) => {
    if (existingCycleIds.has(cycle.id)) return false;
    if (!cycleSearch) return true;
    const searchLower = cycleSearch.toLowerCase();
    return (
      cycle.name.toLowerCase().includes(searchLower) ||
      cycle.course?.name?.toLowerCase().includes(searchLower) ||
      cycle.branch?.name?.toLowerCase().includes(searchLower) ||
      cycle.instructor?.name?.toLowerCase().includes(searchLower)
    );
  });

  const handleSelectCycle = (cycle: Cycle) => {
    setCycleData({
      ...cycleData,
      cycleId: cycle.id,
      cycleName: `${cycle.name} - ${cycle.course?.name} (${cycle.branch?.name})`,
    });
    setCycleSearch('');
    setShowCycleDropdown(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const studentData = {
      ...formData,
      birthDate: formData.birthDate || undefined,
    };

    if (addToCycle && cycleData.cycleId) {
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
    <>
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
            rows={2}
          />
        </div>

        {/* Add to Cycle Section */}
        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              id="addToCycle"
              checked={addToCycle}
              onChange={(e) => setAddToCycle(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="addToCycle" className="text-sm font-medium text-gray-700 flex items-center gap-1">
              <BookOpen size={16} />
              הוסף למחזור נוסף
            </label>
          </div>

          {addToCycle && (
            <div className="bg-blue-50 rounded-lg p-4 space-y-4">
              <div>
                <label className="form-label">בחר מחזור *</label>
                <div className="relative">
                  {cycleData.cycleId ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 form-input bg-white flex items-center justify-between">
                        <span className="text-sm">{cycleData.cycleName}</span>
                        <button
                          type="button"
                          onClick={() => setCycleData({ ...cycleData, cycleId: '', cycleName: '' })}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <input
                          type="text"
                          value={cycleSearch}
                          onChange={(e) => {
                            setCycleSearch(e.target.value);
                            setShowCycleDropdown(true);
                          }}
                          onFocus={() => setShowCycleDropdown(true)}
                          onBlur={() => setTimeout(() => setShowCycleDropdown(false), 200)}
                          placeholder="חפש מחזור..."
                          className="form-input"
                        />
                        {showCycleDropdown && (
                          <button
                            type="button"
                            onClick={() => setShowCycleDropdown(false)}
                            className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {showCycleDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-auto">
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setShowCycleDropdown(false);
                              setShowNewCycleModal(true);
                            }}
                            className="w-full px-3 py-2 text-right bg-green-50 hover:bg-green-100 text-green-700 font-medium text-sm flex items-center gap-2 sticky top-0 border-b border-green-200"
                          >
                            <Plus size={16} />
                            צור מחזור חדש
                          </button>
                          {filteredCycles.length > 0 ? (
                            filteredCycles.map((cycle) => (
                              <button
                                key={cycle.id}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => handleSelectCycle(cycle)}
                                className="w-full px-3 py-2 text-right hover:bg-blue-50 border-b border-gray-100 last:border-0"
                              >
                                <div className="font-medium text-sm">{cycle.name}</div>
                                <div className="text-xs text-gray-500">
                                  {cycle.course?.name} • {cycle.branch?.name}
                                </div>
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-sm text-gray-500 text-center">
                              לא נמצאו מחזורים
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
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
            {isLoading ? 'שומר...' : addToCycle ? 'שמור והוסף למחזור' : 'שמור'}
          </button>
        </div>
      </form>

      {/* New Cycle Modal */}
      {showNewCycleModal && (
        <QuickCycleForm
          onClose={() => setShowNewCycleModal(false)}
          onCreated={(newCycle) => {
            handleSelectCycle(newCycle);
            setShowNewCycleModal(false);
            if (onCycleCreated) onCycleCreated();
          }}
        />
      )}
    </>
  );
}

// WhatsApp Form
interface WhatsAppFormProps {
  phone: string;
  customerName: string;
  onSubmit: (message: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function WhatsAppForm({ phone, customerName, onSubmit, onCancel, isLoading }: WhatsAppFormProps) {
  const [message, setMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(message);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="bg-green-50 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-3">
          <MessageCircle className="text-green-600" size={24} />
          <div>
            <p className="font-medium text-green-800">{customerName}</p>
            <p className="text-sm text-green-600" dir="ltr">{phone}</p>
          </div>
        </div>
      </div>

      <div>
        <label className="form-label">תוכן ההודעה *</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="form-input"
          rows={5}
          placeholder="כתוב את ההודעה כאן..."
          required
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button type="submit" className="btn bg-green-600 hover:bg-green-700 text-white" disabled={isLoading || !message.trim()}>
          {isLoading ? 'שולח...' : 'שלח בוואטסאפ'}
        </button>
      </div>
    </form>
  );
}

// Email Form
interface EmailFormProps {
  email: string;
  customerName: string;
  onSubmit: (subject: string, body: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function EmailForm({ email, customerName, onSubmit, onCancel, isLoading }: EmailFormProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(subject, body);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div className="bg-blue-50 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mail className="text-blue-600" size={24} />
            <div>
              <p className="font-medium text-blue-800">{customerName}</p>
              <p className="text-sm text-blue-600" dir="ltr">{email}</p>
            </div>
          </div>
          <div className="text-xs text-blue-500">
            מאת: info@hai.tech
          </div>
        </div>
      </div>

      <div>
        <label className="form-label">נושא *</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="form-input"
          placeholder="נושא האימייל"
          required
        />
      </div>

      <div>
        <label className="form-label">תוכן *</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="form-input"
          rows={8}
          placeholder="כתוב את תוכן האימייל כאן..."
          required
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          ביטול
        </button>
        <button type="submit" className="btn btn-primary" disabled={isLoading || !subject.trim() || !body.trim()}>
          {isLoading ? 'שולח...' : 'שלח אימייל'}
        </button>
      </div>
    </form>
  );
}

// Communication History Component
function CommunicationHistory({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['communication-history', customerId],
    queryFn: async () => {
      // Get audit logs for this customer (both whatsapp and email)
      const [whatsappRes, emailRes] = await Promise.all([
        api.get(`/audit?entity=communication_whatsapp&entityId=${customerId}&limit=50`),
        api.get(`/audit?entity=communication_email&entityId=${customerId}&limit=50`),
      ]);
      
      const whatsappLogs = whatsappRes.data?.data || [];
      const emailLogs = emailRes.data?.data || [];
      
      // Combine and sort by date
      const allLogs = [...whatsappLogs, ...emailLogs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      return allLogs;
    },
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const logs = data || [];

  return (
    <div className="lg:col-span-3 card">
      <div className="card-header flex items-center gap-2">
        <Clock size={18} className="text-gray-500" />
        <h2 className="font-semibold">היסטוריית תקשורת ({logs.length})</h2>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-gray-500">טוען...</div>
      ) : logs.length > 0 ? (
        <div className="divide-y divide-gray-100 max-h-96 overflow-auto">
          {logs.map((log: any) => (
            <div key={log.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${log.entity === 'communication_whatsapp' ? 'bg-green-100' : 'bg-blue-100'}`}>
                  {log.entity === 'communication_whatsapp' ? (
                    <MessageCircle size={16} className="text-green-600" />
                  ) : (
                    <Mail size={16} className="text-blue-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900">
                      {log.entity === 'communication_whatsapp' ? 'וואטסאפ' : 'אימייל'}
                    </span>
                    <span className="text-xs text-gray-500">{formatDate(log.createdAt)}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    נשלח ע"י {log.userName || 'מערכת'}
                  </p>
                  {log.entity === 'communication_whatsapp' && log.newValue?.message && (
                    <p className="text-sm text-gray-700 mt-2 bg-gray-50 rounded p-2 whitespace-pre-wrap">
                      {log.newValue.message}
                    </p>
                  )}
                  {log.entity === 'communication_email' && (
                    <div className="mt-2 bg-gray-50 rounded p-2">
                      <p className="text-sm font-medium text-gray-800">נושא: {log.newValue?.subject}</p>
                      {log.newValue?.bodyPreview && (
                        <p className="text-sm text-gray-600 mt-1">{log.newValue.bodyPreview}...</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-8 text-center">
          <MessageCircle size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">אין היסטוריית תקשורת</p>
          <p className="text-sm text-gray-400 mt-1">הודעות וואטסאפ ואימיילים יופיעו כאן</p>
        </div>
      )}
    </div>
  );
}

// Payment History Component
function PaymentHistory({ customerId }: { customerId: string }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['payment-history', customerId],
    queryFn: async () => {
      const res = await api.get(`/payments/customer/${customerId}`);
      return res.data as any[];
    },
    refetchInterval: 30000,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const payments = data || [];
  const formatDate = (d: string) => new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const statusLabel = (s: string) => {
    if (s === 'paid') return { label: 'שולם ✅', cls: 'bg-green-100 text-green-700' };
    if (s === 'cancelled') return { label: 'בוטל ❌', cls: 'bg-red-100 text-red-700' };
    return { label: 'ממתין ⏳', cls: 'bg-yellow-100 text-yellow-700' };
  };

  const startEdit = (p: any) => {
    setEditingId(p.id);
    setEditUrl(p.invoiceUrl || '');
  };

  const saveInvoiceUrl = async (paymentId: string) => {
    setSaving(true);
    try {
      await api.patch(`/payments/${paymentId}`, { invoiceUrl: editUrl || null });
      setEditingId(null);
      refetch();
    } catch (e) {
      alert('שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  if (!isLoading && payments.length === 0) return null;

  return (
    <div className="lg:col-span-3 card">
      <div className="card-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard size={18} className="text-purple-600" />
          <h2 className="font-semibold">היסטוריית תשלומים ({payments.length})</h2>
        </div>
        <button onClick={() => refetch()} className="text-xs text-gray-400 hover:text-gray-600">רענן</button>
      </div>

      {isLoading ? (
        <div className="p-4 text-center text-gray-500">טוען...</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {payments.map((p: any) => {
            const st = statusLabel(p.status);
            const purchaseDate = p.paidAt || p.createdAt;
            const isDigital = !!p.wooOrderId;
            const isEditing = editingId === p.id;
            return (
              <div key={p.id}>
                <div className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {isDigital && <span className="text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-medium shrink-0">🎓 דיגיטלי</span>}
                      <p className="font-medium text-sm truncate">{p.description}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      נרכש: {formatDate(purchaseDate)}
                      {p.wooOrderId && <span className="mr-2 text-gray-300">הזמנה #{p.wooOrderId}</span>}
                    </p>
                  </div>
                  <span className="text-base font-bold text-purple-700 shrink-0">
                    ₪{Number(p.amount).toLocaleString()}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${st.cls}`}>
                    {st.label}
                  </span>
                  {p.invoiceUrl ? (
                    <a href={p.invoiceUrl} target="_blank" rel="noreferrer"
                      title="פתח חשבונית"
                      className="shrink-0 text-green-600 hover:text-green-800">
                      <FileText size={16} />
                    </a>
                  ) : p.wooOrderId ? (
                    <a href={`https://app.greeninvoice.co.il/documents?search=${p.customerName}`}
                      target="_blank" rel="noreferrer"
                      title="חפש חשבונית במורנינג"
                      className="shrink-0 text-orange-400 hover:text-orange-600">
                      <FileText size={16} />
                    </a>
                  ) : null}
                  {/* Edit invoice URL button */}
                  <button
                    onClick={() => isEditing ? setEditingId(null) : startEdit(p)}
                    title="ערוך לינק חשבונית"
                    className={`shrink-0 p-1 rounded hover:bg-gray-100 transition-colors ${isEditing ? 'text-blue-600' : 'text-gray-300 hover:text-gray-500'}`}
                  >
                    <Pencil size={14} />
                  </button>
                </div>
                {/* Inline edit row */}
                {isEditing && (
                  <div className="px-5 pb-3 flex items-center gap-2 bg-blue-50">
                    <input
                      type="url"
                      value={editUrl}
                      onChange={e => setEditUrl(e.target.value)}
                      placeholder="https://app.greeninvoice.co.il/..."
                      className="flex-1 text-sm border border-blue-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      dir="ltr"
                      autoFocus
                    />
                    <button
                      onClick={() => saveInvoiceUrl(p.id)}
                      disabled={saving}
                      className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? '...' : 'שמור'}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1.5"
                    >
                      ביטול
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Quick Cycle Form (for creating new cycle from student form)
interface QuickCycleFormProps {
  onClose: () => void;
  onCreated: (cycle: Cycle) => void;
}

function QuickCycleForm({ onClose, onCreated }: QuickCycleFormProps) {
  const { data: courses } = useCourses();
  const { data: branches } = useBranches();
  const { data: instructors } = useInstructors();
  const createCycle = useCreateCycle();

  const [formData, setFormData] = useState({
    name: '',
    courseId: '',
    branchId: '',
    instructorId: '',
    dayOfWeek: 'sunday' as any,
    startTime: '16:00',
    endTime: '17:30',
    startDate: new Date().toISOString().split('T')[0],
    totalMeetings: 12,
    activityType: 'frontal' as 'online' | 'frontal' | 'private_lesson',
    cycleType: 'institutional_per_child' as 'private' | 'institutional_per_child' | 'institutional_fixed',
  });

  // Auto-update cycle type when activity type changes to private_lesson
  const handleActivityTypeChange = (value: string) => {
    const newActivityType = value as 'online' | 'frontal' | 'private_lesson';
    const newCycleType = newActivityType === 'private_lesson' ? 'private' : formData.cycleType;
    setFormData({ ...formData, activityType: newActivityType, cycleType: newCycleType });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Calculate duration in minutes from start and end time
      const [startHour, startMin] = formData.startTime.split(':').map(Number);
      const [endHour, endMin] = formData.endTime.split(':').map(Number);
      const durationMinutes = (endHour * 60 + endMin) - (startHour * 60 + startMin);

      const result = await createCycle.mutateAsync({
        ...formData,
        status: 'active',
        type: formData.cycleType,
        durationMinutes,
        activityType: formData.activityType,
      });
      onCreated(result as Cycle);
    } catch (error) {
      console.error('Failed to create cycle:', error);
      alert('שגיאה ביצירת המחזור');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-lg">מחזור חדש</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="form-label">שם המחזור *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="form-input"
              placeholder="לדוגמה: מחזור א' - תכנות מתקדמים"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">קורס *</label>
              <select
                value={formData.courseId}
                onChange={(e) => setFormData({ ...formData, courseId: e.target.value })}
                className="form-input"
                required
              >
                <option value="">בחר קורס...</option>
                {courses?.map((course) => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label">סניף *</label>
              <select
                value={formData.branchId}
                onChange={(e) => setFormData({ ...formData, branchId: e.target.value })}
                className="form-input"
                required
              >
                <option value="">בחר סניף...</option>
                {branches?.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">מדריך *</label>
              <select
                value={formData.instructorId}
                onChange={(e) => setFormData({ ...formData, instructorId: e.target.value })}
                className="form-input"
                required
              >
                <option value="">בחר מדריך...</option>
                {instructors?.filter(i => i.isActive).map((instructor) => (
                  <option key={instructor.id} value={instructor.id}>{instructor.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label">סוג פעילות</label>
              <select
                value={formData.activityType}
                onChange={(e) => handleActivityTypeChange(e.target.value)}
                className="form-input"
              >
                <option value="frontal">פרונטלי</option>
                <option value="online">אונליין</option>
                <option value="private_lesson">שיעור פרטי</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">סוג מחזור</label>
              <select
                value={formData.cycleType}
                onChange={(e) => setFormData({ ...formData, cycleType: e.target.value as any })}
                className="form-input"
              >
                <option value="private">פרטי (הכנסה מהרשמות)</option>
                <option value="institutional_per_child">מוסדי - לפי ילד</option>
                <option value="institutional_fixed">מוסדי - סכום קבוע</option>
              </select>
            </div>

            <div>
              <label className="form-label">יום בשבוע</label>
              <select
                value={formData.dayOfWeek}
                onChange={(e) => setFormData({ ...formData, dayOfWeek: e.target.value })}
                className="form-input"
              >
                <option value="sunday">ראשון</option>
                <option value="monday">שני</option>
                <option value="tuesday">שלישי</option>
                <option value="wednesday">רביעי</option>
                <option value="thursday">חמישי</option>
                <option value="friday">שישי</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">שעת התחלה</label>
              <input
                type="time"
                value={formData.startTime}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                className="form-input"
              />
            </div>

            <div>
              <label className="form-label">שעת סיום</label>
              <input
                type="time"
                value={formData.endTime}
                onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                className="form-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">תאריך התחלה</label>
              <input
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className="form-input"
              />
            </div>

            <div>
              <label className="form-label">מספר מפגשים</label>
              <input
                type="number"
                value={formData.totalMeetings}
                onChange={(e) => setFormData({ ...formData, totalMeetings: Number(e.target.value) })}
                className="form-input"
                min="1"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              ביטול
            </button>
            <button type="submit" className="btn btn-primary" disabled={createCycle.isPending}>
              {createCycle.isPending ? 'יוצר...' : 'צור מחזור'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
