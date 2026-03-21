import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, User, GraduationCap, Plus, CreditCard, BookOpen, Edit, Check, LayoutGrid, List, ChevronUp, ChevronDown, ChevronsUpDown, Trash2, X, Download } from 'lucide-react';
import { useStudents, useCycles, useCreateRegistration, useUpdateRegistration, useUpdateStudent, useDeleteStudent, useCreateStudent, useCustomers } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonTable } from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal';
import ViewSelector from '../components/ViewSelector';
import type { Student, Cycle, Registration, PaymentStatus, PaymentMethod, Customer } from '../types';
import { paymentStatusHebrew } from '../types';

export default function Students() {
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('students-view') as 'grid' | 'list') || 'list'
  );
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const toggleViewMode = (mode: 'grid' | 'list') => { setViewMode(mode); localStorage.setItem('students-view', mode); };
  const handleSort = (key: string) => setSortConfig(prev => prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  const [registerStudent, setRegisterStudent] = useState<Student | null>(null);
  const [editPayment, setEditPayment] = useState<{ student: Student; registration: Registration } | null>(null);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Student | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  
  const { data: students, isLoading } = useStudents();
  const { data: cycles } = useCycles({ status: 'active' });
  const { data: customersResult } = useCustomers({ limit: 5000 });
  const customers = customersResult?.data ?? [];
  const createRegistration = useCreateRegistration();
  const updateRegistration = useUpdateRegistration();
  const updateStudent = useUpdateStudent();
  const deleteStudent = useDeleteStudent();
  const createStudent = useCreateStudent();

  const filteredStudents = (() => {
    let list = students?.filter((student) =>
      student.name.toLowerCase().includes(search.toLowerCase()) ||
      student.customer?.name.toLowerCase().includes(search.toLowerCase())
    ) || [];
    if (sortConfig) {
      list = [...list].sort((a, b) => {
        switch (sortConfig.key) {
          case 'name':
            return sortConfig.direction === 'asc'
              ? String(a.name ?? '').localeCompare(String(b.name ?? ''), 'he')
              : String(b.name ?? '').localeCompare(String(a.name ?? ''), 'he');
          case 'grade':
            return sortConfig.direction === 'asc'
              ? String(a.grade ?? '').localeCompare(String(b.grade ?? ''), 'he')
              : String(b.grade ?? '').localeCompare(String(a.grade ?? ''), 'he');
          case 'customer':
            return sortConfig.direction === 'asc'
              ? String(a.customer?.name ?? '').localeCompare(String(b.customer?.name ?? ''), 'he')
              : String(b.customer?.name ?? '').localeCompare(String(a.customer?.name ?? ''), 'he');
          case 'registrations': {
            const av = a.registrations?.length ?? 0, bv = b.registrations?.length ?? 0;
            return sortConfig.direction === 'asc' ? av - bv : bv - av;
          }
          default: return 0;
        }
      });
    }
    return list;
  })();

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
      // placeholder to keep code structure
    }
  };

  const handleDeleteStudent = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteStudent.mutateAsync({ studentId: deleteConfirm.id, customerId: deleteConfirm.customerId || '' });
      setDeleteConfirm(null);
      setSelectedStudentIds(prev => { const s = new Set(prev); s.delete(deleteConfirm.id); return s; });
    } catch (error: any) {
      alert(error?.response?.data?.message || 'שגיאה במחיקת התלמיד');
    }
  };

  const handleAddStudent = async (data: { customerId: string; name: string; birthDate?: string; grade?: string; notes?: string }) => {
    const { customerId, ...studentData } = data;
    try {
      await createStudent.mutateAsync({ customerId, data: studentData });
      setShowAddModal(false);
    } catch (error: any) {
      alert(error?.response?.data?.message || 'שגיאה בהוספת התלמיד');
    }
  };

  const handleBulkExport = () => {
    const selected = filteredStudents.filter(s => selectedStudentIds.has(s.id));
    const csv = ['שם,לקוח,כיתה,הרשמות', ...selected.map(s => `"${s.name}","${s.customer?.name || ''}","${s.grade || ''}","${s.registrations?.length || 0}"`)].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'students.csv'; link.click();
  };

  // Get cycles student is not already registered to
  const getAvailableCycles = (student: Student) => {
    const registeredCycleIds = new Set(student.registrations?.map(r => r.cycleId) || []);
    return cycles?.filter(c => !registeredCycleIds.has(c.id)) || [];
  };

  return (
    <>
      <PageHeader
        title="תלמידים"
        subtitle={`${filteredStudents.length} תלמידים`}
        actions={
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus size={18} /> תלמיד חדש
          </button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        {/* Search & Controls */}
        <div className="mb-6 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="חיפוש לפי שם תלמיד או לקוח..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input pr-10 w-full"
            />
          </div>
          <span className="text-sm text-gray-500 mr-auto">{filteredStudents.length} תלמידים</span>
          {selectedStudentIds.size > 0 && (
            <>
              <span className="text-sm text-blue-600 font-medium bg-blue-50 px-3 py-1 rounded-full">נבחרו {selectedStudentIds.size}</span>
              <button onClick={() => setShowBulkEditModal(true)} className="btn btn-primary btn-sm flex items-center gap-1"><Edit size={14} />עריכה גורפת</button>
              <button onClick={handleBulkExport} className="btn btn-secondary btn-sm flex items-center gap-1"><Download size={14} />ייצא</button>
              <button onClick={() => setSelectedStudentIds(new Set())} className="btn btn-secondary btn-sm flex items-center gap-1"><X size={14} />בטל</button>
            </>
          )}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => toggleViewMode('grid')} className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="כרטיסיות"><LayoutGrid size={16} /></button>
            <button onClick={() => toggleViewMode('list')} className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`} title="שורות"><List size={16} /></button>
          </div>
          <ViewSelector entity="students" onApplyView={() => {}} />
        </div>

        {/* Students List */}
        {isLoading ? (
          <SkeletonTable rows={8} columns={5} />
        ) : filteredStudents.length > 0 ? (
          <>
          {/* Card view */}
          <div className={`${viewMode === 'grid' ? 'grid' : 'hidden'} grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`}>
            {filteredStudents.map((student) => (
              <div key={student.id} className="group bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all duration-200 hover:-translate-y-0.5">
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-sm">
                        <GraduationCap size={18} className="text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">{student.name}</h3>
                        {student.grade && <span className="text-xs text-gray-500">כיתה {student.grade}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setEditStudent(student)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="עריכה"><Edit size={14} /></button>
                      <button onClick={() => setRegisterStudent(student)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="הרשמה"><Plus size={14} /></button>
                      <button onClick={() => setDeleteConfirm(student)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="מחיקה"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {student.customer && (
                    <Link to={`/customers/${student.customer.id}`} className="text-sm text-blue-600 hover:underline block mb-2">{student.customer.name}</Link>
                  )}
                  {student.registrations && student.registrations.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-gray-50">
                      {student.registrations.map((reg) => (
                        <button
                          key={reg.id}
                          onClick={() => setEditPayment({ student, registration: reg })}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 border ${
                            reg.paymentStatus === 'paid' ? 'bg-green-50 text-green-700 border-green-200' :
                            reg.paymentStatus === 'partial' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                            'bg-red-50 text-red-700 border-red-200'
                          }`}
                        >
                          <CreditCard size={10} />
                          {reg.cycle?.course?.name?.substring(0, 12) || 'מחזור'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* List/table view */}
          <div className={`${viewMode === 'list' ? 'block' : 'hidden'} bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden`}>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th className="w-12 p-3">
                      <input
                        type="checkbox"
                        checked={selectedStudentIds.size === filteredStudents.length && filteredStudents.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    {[['name','שם התלמיד','right'],['customer','לקוח (הורה)','right'],['grade','כיתה','right'],['registrations','הרשמות','center']].map(([k,l,a]) => (
                      <th key={k} className={`p-3 font-medium text-gray-600 cursor-pointer select-none hover:bg-gray-100 transition-colors text-${a}`} onClick={() => handleSort(k)}>
                        <span className="inline-flex items-center gap-1">{l}{sortConfig?.key===k ? (sortConfig.direction==='asc' ? <ChevronUp size={13} className="text-blue-600"/> : <ChevronDown size={13} className="text-blue-600"/>) : <ChevronsUpDown size={13} className="text-gray-400"/>}</span>
                      </th>
                    ))}
                    <th className="p-3 text-right font-medium text-gray-600">תאריך לידה</th>
                    <th className="p-3 text-right font-medium text-gray-600">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredStudents.map((student) => (
                    <tr key={student.id} className={`hover:bg-gray-50 transition-colors ${selectedStudentIds.has(student.id) ? 'bg-blue-50' : ''}`}>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedStudentIds.has(student.id)}
                          onChange={() => toggleSelectStudent(student.id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center shadow-sm">
                            <GraduationCap size={16} className="text-white" />
                          </div>
                          <span className="font-medium text-gray-900">{student.name}</span>
                        </div>
                      </td>
                      <td className="p-3">
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
                      <td className="p-3 text-gray-600">{student.grade || <span className="text-gray-400">-</span>}</td>
                      <td className="p-3 text-gray-600">
                        {student.registrations && student.registrations.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {student.registrations.map((reg) => (
                              <button key={reg.id} onClick={() => setEditPayment({ student, registration: reg })}
                                className={`px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 border ${reg.paymentStatus === 'paid' ? 'bg-green-50 text-green-700 border-green-200' : reg.paymentStatus === 'partial' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                <CreditCard size={10} />{reg.cycle?.course?.name?.substring(0, 10) || 'מחזור'}
                              </button>
                            ))}
                          </div>
                        ) : <span className="text-gray-400 text-xs italic">אין</span>}
                      </td>
                      <td className="p-3 text-gray-600">
                        {student.birthDate ? new Date(student.birthDate).toLocaleDateString('he-IL') : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setEditStudent(student)} className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors flex items-center gap-1"><Edit size={14} />עריכה</button>
                          <button onClick={() => setRegisterStudent(student)} className="text-green-600 hover:text-green-700 text-sm transition-colors flex items-center gap-1"><Plus size={14} />הרשמה</button>
                          <button onClick={() => setDeleteConfirm(student)} className="p-1.5 hover:bg-red-100 rounded transition-colors text-red-500" title="מחיקה"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>
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

      {/* Add Student Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="תלמיד חדש">
        <AddStudentForm
          customers={customers || []}
          onSubmit={handleAddStudent}
          onCancel={() => setShowAddModal(false)}
          isLoading={createStudent.isPending}
        />
      </Modal>

      {/* Delete Confirm Modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDeleteStudent}
        title="מחיקת תלמיד"
        itemName={deleteConfirm?.name}
        warningText={(deleteConfirm?.registrations?.length || 0) > 0 ? `לתלמיד יש ${deleteConfirm?.registrations?.length} הרשמות פעילות` : undefined}
        isLoading={deleteStudent.isPending}
      />
    </>
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
                  <option value="standing_order">הוראת קבע</option>
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
                  <option value="standing_order">הוראת קבע</option>
          </select>
        </div>

        <div>
          <label className="form-label">קישור לחשבונית</label>
          <div className="flex gap-2 items-center">
            <input
              type="url"
              value={formData.invoiceLink}
              onChange={(e) => setFormData({ ...formData, invoiceLink: e.target.value })}
              className="form-input flex-1"
              dir="ltr"
              placeholder="https://..."
            />
            {formData.invoiceLink && (
              <a
                href={formData.invoiceLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-sm font-medium transition-colors border border-blue-200"
                title="פתח חשבונית"
              >
                🔗 פתח
              </a>
            )}
          </div>
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

// Add Student Form
interface AddStudentFormProps {
  customers: Customer[];
  onSubmit: (data: { customerId: string; name: string; birthDate?: string; grade?: string; notes?: string }) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function AddStudentForm({ customers, onSubmit, onCancel, isLoading }: AddStudentFormProps) {
  const [formData, setFormData] = useState({
    customerId: '',
    name: '',
    birthDate: '',
    grade: '',
    notes: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      customerId: formData.customerId,
      name: formData.name,
      birthDate: formData.birthDate || undefined,
      grade: formData.grade || undefined,
      notes: formData.notes || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div>
        <label className="form-label">לקוח (הורה) *</label>
        <select
          value={formData.customerId}
          onChange={(e) => setFormData({ ...formData, customerId: e.target.value })}
          className="form-input"
          required
        >
          <option value="">בחר לקוח...</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
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
            placeholder="כיתה ג׳"
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
      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn btn-secondary">ביטול</button>
        <button type="submit" className="btn btn-primary" disabled={isLoading || !formData.customerId || !formData.name}>
          {isLoading ? 'שומר...' : 'הוסף תלמיד'}
        </button>
      </div>
    </form>
  );
}
