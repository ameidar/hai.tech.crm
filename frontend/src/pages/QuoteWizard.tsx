import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Check, Loader2, Plus, Trash2, Sparkles, Save, Send } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { quotesApi, type QuoteItem, type CreateQuoteData } from '../api/quotes';
import { fetchData } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import type { Course, Branch, Customer } from '../types';

const steps = [
  { label: 'פרטי מוסד', number: 1 },
  { label: 'בחירת קורסים', number: 2 },
  { label: 'תמחור', number: 3 },
  { label: 'תוכן הצעה', number: 4 },
  { label: 'תצוגה מקדימה', number: 5 },
];

interface InstitutionData {
  clientType: 'private' | 'institutional';
  institutionName: string;
  customerId: string;
  branchId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  contactRole: string;
  payingBodyName: string;
  payingBodyPhone: string;
  payingBodyEmail: string;
  payingBodyNotes: string;
}

type ItemType = 'education' | 'project';

interface CourseItem {
  type: ItemType;
  courseId: string;
  courseName: string;
  description: string;
  // Education fields
  groupsCount: number;
  meetingsPerGroup: number;
  durationMinutes: number;
  pricePerMeeting: number;
  // Project fields
  totalPrice: number;
}

export default function QuoteWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1
  const [institution, setInstitution] = useState<InstitutionData>({
    clientType: 'institutional',
    institutionName: '',
    customerId: '',
    branchId: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    contactRole: '',
    payingBodyName: '',
    payingBodyPhone: '',
    payingBodyEmail: '',
    payingBodyNotes: '',
  });
  const [customerSearch, setCustomerSearch] = useState('');
  const [branchSearch, setBranchSearch] = useState('');
  const [showPayingBody, setShowPayingBody] = useState(false);

  // Step 2
  const [courseItems, setCourseItems] = useState<CourseItem[]>([]);

  // Step 3
  const [discount, setDiscount] = useState(0);

  // Step 4 & 5
  const [generatedContent, setGeneratedContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: courses } = useQuery({
    queryKey: ['courses'],
    queryFn: () => fetchData<Course[]>('/courses'),
  });

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => fetchData<Branch[]>('/branches'),
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers', customerSearch],
    queryFn: () => fetchData<{ data: Customer[] }>(`/customers?search=${encodeURIComponent(customerSearch)}&limit=20`),
    enabled: institution.clientType === 'private' && customerSearch.length >= 2,
  });
  const customers = (customersData as any)?.data || customersData || [];

  const createQuote = useMutation({
    mutationFn: (data: CreateQuoteData) => quotesApi.create(data),
    onSuccess: (quote) => {
      navigate(`/quotes/${quote.id}`);
    },
  });

  // Calculate totals
  const calculateSubtotal = (item: CourseItem) =>
    item.type === 'project' ? item.totalPrice : item.groupsCount * item.meetingsPerGroup * item.pricePerMeeting;

  const subtotal = courseItems.reduce((sum, item) => sum + calculateSubtotal(item), 0);
  const discountAmount = (subtotal * discount) / 100;
  const totalAmount = subtotal - discountAmount;

  // Validation
  const isStep1Valid = institution.institutionName && institution.contactName && (institution.contactPhone || institution.contactEmail);
  const isStep2Valid = courseItems.length > 0 && courseItems.every(
    (item) => {
      if (!item.courseId && !item.courseName) return false;
      if (item.type === 'project') return item.totalPrice > 0;
      return item.groupsCount > 0 && item.meetingsPerGroup > 0 && item.pricePerMeeting > 0;
    }
  );

  const canProceed = () => {
    switch (currentStep) {
      case 1: return isStep1Valid;
      case 2: return isStep2Valid;
      case 3: return true;
      case 4: return true;
      case 5: return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (currentStep < 5 && canProceed()) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const addCourseItem = (type: ItemType = 'education') => {
    setCourseItems([...courseItems, {
      type,
      courseId: '',
      courseName: '',
      description: '',
      groupsCount: 1,
      meetingsPerGroup: 12,
      durationMinutes: 90,
      pricePerMeeting: 0,
      totalPrice: 0,
    }]);
  };

  const updateCourseItem = (index: number, field: keyof CourseItem, value: any) => {
    const updated = [...courseItems];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'courseId') {
      const course = courses?.find((c) => c.id === value);
      if (course) {
        updated[index].courseName = course.name;
      }
    }
    setCourseItems(updated);
  };

  const removeCourseItem = (index: number) => {
    setCourseItems(courseItems.filter((_, i) => i !== index));
  };

  const handleGenerateContent = async () => {
    setIsGenerating(true);
    try {
      const result = await quotesApi.generateContentPreview({
        institutionName: institution.institutionName,
        contactName: institution.contactName,
        items: courseItems.map((item) => ({
          type: item.type,
          courseName: item.courseName,
          description: item.description,
          groupsCount: item.type === 'project' ? 1 : item.groupsCount,
          meetingsPerGroup: item.type === 'project' ? 1 : item.meetingsPerGroup,
          durationMinutes: item.durationMinutes,
          pricePerMeeting: item.type === 'project' ? item.totalPrice : item.pricePerMeeting,
          subtotal: calculateSubtotal(item),
        })),
      });
      setGeneratedContent(result.content);
    } catch (error) {
      console.error('Failed to generate content:', error);
      alert('שגיאה ביצירת התוכן');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async (status: 'draft' | 'sent') => {
    const data: any = {
      institutionName: institution.institutionName,
      contactName: institution.contactName,
      contactPhone: institution.contactPhone || undefined,
      contactEmail: institution.contactEmail || undefined,
      contactRole: institution.contactRole || undefined,
      branchId: institution.branchId || undefined,
      clientType: institution.clientType || undefined,
      customerId: institution.customerId || undefined,
      payingBodyName: institution.payingBodyName || undefined,
      payingBodyPhone: institution.payingBodyPhone || undefined,
      payingBodyEmail: institution.payingBodyEmail || undefined,
      payingBodyNotes: institution.payingBodyNotes || undefined,
      items: courseItems.map((item) => ({
        courseId: item.courseId || undefined,
        courseName: item.courseName,
        description: item.description || undefined,
        type: item.type,
        groupsCount: item.type === 'project' ? 1 : item.groupsCount,
        meetingsPerGroup: item.type === 'project' ? 1 : item.meetingsPerGroup,
        durationMinutes: item.durationMinutes,
        pricePerMeeting: item.type === 'project' ? item.totalPrice : item.pricePerMeeting,
      })),
      discount,
      generatedContent: generatedContent || undefined,
      status,
    };

    try {
      await createQuote.mutateAsync(data);
    } catch (error) {
      console.error('Failed to create quote:', error);
      alert('שגיאה ביצירת ההצעה');
    }
  };

  return (
    <>
      <PageHeader
        title="הצעת מחיר חדשה"
        actions={
          <button onClick={() => navigate('/quotes')} className="btn btn-secondary">
            <ArrowRight size={18} />
            חזרה
          </button>
        }
      />

      <div className="flex-1 p-4 md:p-6 overflow-auto">
        {/* Stepper */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2">
            {steps.map((step, index) => (
              <div key={step.number} className="flex items-center">
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold transition-colors ${
                    currentStep === step.number
                      ? 'bg-blue-600 text-white'
                      : currentStep > step.number
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {currentStep > step.number ? <Check size={18} /> : step.number}
                </div>
                <span className={`mr-2 text-sm hidden md:inline ${
                  currentStep === step.number ? 'text-blue-600 font-medium' : 'text-gray-500'
                }`}>
                  {step.label}
                </span>
                {index < steps.length - 1 && (
                  <div className={`w-8 md:w-16 h-0.5 mx-2 ${
                    currentStep > step.number ? 'bg-green-500' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="max-w-4xl mx-auto">
          <div className="card">
            <div className="card-body p-6">
              {/* Step 1: Institution Details */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold mb-4">פרטי לקוח</h3>

                  {/* Client Type Selector */}
                  <div className="flex gap-4 mb-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="clientType"
                        checked={institution.clientType === 'institutional'}
                        onChange={() => setInstitution({ ...institution, clientType: 'institutional', customerId: '' })}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="font-medium">מוסדי</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="clientType"
                        checked={institution.clientType === 'private'}
                        onChange={() => setInstitution({ ...institution, clientType: 'private', branchId: '' })}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="font-medium">פרטי</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Institutional: Branch search */}
                    {institution.clientType === 'institutional' && (
                      <div className="col-span-2 md:col-span-1">
                        <label className="form-label">סניף / מוסד</label>
                        <select
                          value={institution.branchId}
                          onChange={(e) => {
                            const branch = branches?.find(b => b.id === e.target.value);
                            setInstitution({
                              ...institution,
                              branchId: e.target.value,
                              institutionName: branch ? branch.name : institution.institutionName,
                              contactName: branch?.contactName || institution.contactName,
                              contactPhone: branch?.contactPhone || institution.contactPhone,
                              contactEmail: branch?.contactEmail || institution.contactEmail,
                            });
                          }}
                          className="form-input"
                        >
                          <option value="">לקוח חדש / בחר סניף</option>
                          {branches?.map((branch) => (
                            <option key={branch.id} value={branch.id}>{branch.name} - {branch.city || ''}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Private: Customer search */}
                    {institution.clientType === 'private' && (
                      <div className="col-span-2 md:col-span-1">
                        <label className="form-label">חיפוש לקוח קיים</label>
                        <input
                          type="text"
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          className="form-input"
                          placeholder="הקלד שם או טלפון..."
                        />
                        {Array.isArray(customers) && customers.length > 0 && customerSearch.length >= 2 && (
                          <div className="border rounded-lg mt-1 max-h-40 overflow-y-auto bg-white shadow-lg">
                            <button
                              type="button"
                              onClick={() => {
                                setInstitution({ ...institution, customerId: '' });
                                setCustomerSearch('');
                              }}
                              className="w-full text-right px-3 py-2 hover:bg-gray-100 text-sm text-blue-600 font-medium border-b"
                            >
                              + לקוח חדש
                            </button>
                            {(customers as Customer[]).map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setInstitution({
                                    ...institution,
                                    customerId: c.id,
                                    institutionName: c.name,
                                    contactName: c.name,
                                    contactPhone: c.phone || '',
                                    contactEmail: c.email || '',
                                  });
                                  setCustomerSearch('');
                                }}
                                className="w-full text-right px-3 py-2 hover:bg-gray-100 text-sm"
                              >
                                {c.name} - {c.phone}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className={institution.clientType === 'institutional' ? '' : 'col-span-2 md:col-span-1'}>
                      <label className="form-label">{institution.clientType === 'private' ? 'שם הלקוח *' : 'שם המוסד *'}</label>
                      <input
                        type="text"
                        value={institution.institutionName}
                        onChange={(e) => setInstitution({ ...institution, institutionName: e.target.value })}
                        className="form-input"
                        placeholder={institution.clientType === 'private' ? 'שם הלקוח' : 'לדוגמה: בית ספר אורט'}
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label">שם איש קשר *</label>
                      <input
                        type="text"
                        value={institution.contactName}
                        onChange={(e) => setInstitution({ ...institution, contactName: e.target.value })}
                        className="form-input"
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label">תפקיד</label>
                      <input
                        type="text"
                        value={institution.contactRole}
                        onChange={(e) => setInstitution({ ...institution, contactRole: e.target.value })}
                        className="form-input"
                        placeholder="לדוגמה: רכזת חינוך"
                      />
                    </div>
                    <div>
                      <label className="form-label">טלפון {!institution.contactEmail && '*'}</label>
                      <input
                        type="tel"
                        value={institution.contactPhone}
                        onChange={(e) => setInstitution({ ...institution, contactPhone: e.target.value })}
                        className="form-input"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="form-label">אימייל {!institution.contactPhone && '*'}</label>
                      <input
                        type="email"
                        value={institution.contactEmail}
                        onChange={(e) => setInstitution({ ...institution, contactEmail: e.target.value })}
                        className="form-input"
                        dir="ltr"
                      />
                    </div>
                  </div>
                  {!institution.contactPhone && !institution.contactEmail && (
                    <p className="text-sm text-red-500">יש להזין טלפון או אימייל</p>
                  )}

                  {/* Paying Body - Collapsible */}
                  <div className="border rounded-lg mt-4">
                    <button
                      type="button"
                      onClick={() => setShowPayingBody(!showPayingBody)}
                      className="w-full text-right px-4 py-3 font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-between"
                    >
                      <span>גוף משלם (אופציונלי)</span>
                      <span className="text-gray-400">{showPayingBody ? '▲' : '▼'}</span>
                    </button>
                    {showPayingBody && (
                      <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="form-label">שם גוף משלם</label>
                          <input
                            type="text"
                            value={institution.payingBodyName}
                            onChange={(e) => setInstitution({ ...institution, payingBodyName: e.target.value })}
                            className="form-input"
                          />
                        </div>
                        <div>
                          <label className="form-label">טלפון</label>
                          <input
                            type="tel"
                            value={institution.payingBodyPhone}
                            onChange={(e) => setInstitution({ ...institution, payingBodyPhone: e.target.value })}
                            className="form-input"
                            dir="ltr"
                          />
                        </div>
                        <div>
                          <label className="form-label">מייל</label>
                          <input
                            type="email"
                            value={institution.payingBodyEmail}
                            onChange={(e) => setInstitution({ ...institution, payingBodyEmail: e.target.value })}
                            className="form-input"
                            dir="ltr"
                          />
                        </div>
                        <div>
                          <label className="form-label">הערות</label>
                          <input
                            type="text"
                            value={institution.payingBodyNotes}
                            onChange={(e) => setInstitution({ ...institution, payingBodyNotes: e.target.value })}
                            className="form-input"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Course Selection */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">פריטי ההצעה</h3>
                    <div className="flex gap-2">
                      <button onClick={() => addCourseItem('education')} className="btn btn-primary text-sm">
                        <Plus size={16} />
                        הדרכה / קורס
                      </button>
                      <button onClick={() => addCourseItem('project')} className="btn btn-secondary text-sm">
                        <Plus size={16} />
                        פרויקט / שירות
                      </button>
                    </div>
                  </div>

                  {courseItems.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <p className="mb-4">לא נוספו פריטים</p>
                      <div className="flex gap-3 justify-center">
                        <button onClick={() => addCourseItem('education')} className="btn btn-primary">
                          <Plus size={16} />
                          הדרכה / קורס
                        </button>
                        <button onClick={() => addCourseItem('project')} className="btn btn-secondary">
                          <Plus size={16} />
                          פרויקט / שירות
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {courseItems.map((item, index) => (
                        <div key={index} className={`border rounded-lg p-4 ${item.type === 'project' ? 'border-purple-200 bg-purple-50/30' : 'border-gray-200'}`}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.type === 'project' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                {item.type === 'project' ? 'פרויקט / שירות' : 'הדרכה / קורס'}
                              </span>
                              <h4 className="font-medium text-gray-700">פריט {index + 1}</h4>
                            </div>
                            <button
                              onClick={() => removeCourseItem(index)}
                              className="icon-btn icon-btn-danger"
                              title="הסר"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>

                          {/* Course/Topic name - shared */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="form-label text-xs">{item.type === 'project' ? 'שם השירות / פרויקט *' : 'קורס / נושא *'}</label>
                              <div className="flex gap-2">
                                {item.type === 'education' && (
                                  <select
                                    value={item.courseId}
                                    onChange={(e) => updateCourseItem(index, 'courseId', e.target.value)}
                                    className="form-input text-sm flex-1"
                                  >
                                    <option value="">בחר מהרשימה</option>
                                    {courses?.map((course) => (
                                      <option key={course.id} value={course.id}>{course.name}</option>
                                    ))}
                                  </select>
                                )}
                                <input
                                  type="text"
                                  value={!item.courseId ? item.courseName : ''}
                                  onChange={(e) => {
                                    const updated = [...courseItems];
                                    updated[index] = { ...updated[index], courseId: '', courseName: e.target.value };
                                    setCourseItems(updated);
                                  }}
                                  className="form-input text-sm flex-1"
                                  placeholder={item.type === 'project' ? 'לדוגמה: הטמעת AI לארגון' : 'או הזן נושא חופשי'}
                                  disabled={!!item.courseId}
                                />
                              </div>
                            </div>
                            <div>
                              <label className="form-label text-xs">תיאור (אופציונלי)</label>
                              <input
                                type="text"
                                value={item.description}
                                onChange={(e) => updateCourseItem(index, 'description', e.target.value)}
                                className="form-input text-sm"
                                placeholder="פירוט קצר..."
                              />
                            </div>
                          </div>

                          {/* Type-specific fields */}
                          {item.type === 'education' ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div>
                                <label className="form-label text-xs">קבוצות *</label>
                                <input
                                  type="number"
                                  value={item.groupsCount}
                                  onChange={(e) => updateCourseItem(index, 'groupsCount', Number(e.target.value))}
                                  className="form-input text-sm"
                                  min="1"
                                />
                              </div>
                              <div>
                                <label className="form-label text-xs">מפגשים לקבוצה *</label>
                                <input
                                  type="number"
                                  value={item.meetingsPerGroup}
                                  onChange={(e) => updateCourseItem(index, 'meetingsPerGroup', Number(e.target.value))}
                                  className="form-input text-sm"
                                  min="1"
                                />
                              </div>
                              <div>
                                <label className="form-label text-xs">משך (דקות)</label>
                                <input
                                  type="number"
                                  value={item.durationMinutes}
                                  onChange={(e) => updateCourseItem(index, 'durationMinutes', Number(e.target.value))}
                                  className="form-input text-sm"
                                  min="30"
                                  step="15"
                                />
                              </div>
                              <div>
                                <label className="form-label text-xs">מחיר למפגש (₪) *</label>
                                <input
                                  type="number"
                                  value={item.pricePerMeeting}
                                  onChange={(e) => updateCourseItem(index, 'pricePerMeeting', Number(e.target.value))}
                                  className="form-input text-sm"
                                  min="0"
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="form-label text-xs">מחיר כולל (₪) *</label>
                                <input
                                  type="number"
                                  value={item.totalPrice}
                                  onChange={(e) => updateCourseItem(index, 'totalPrice', Number(e.target.value))}
                                  className="form-input text-sm"
                                  min="0"
                                />
                              </div>
                            </div>
                          )}

                          <div className="mt-2 text-left text-sm text-gray-500">
                            סה״כ: <span className="font-semibold text-green-600">₪{calculateSubtotal(item).toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Pricing */}
              {currentStep === 3 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold mb-4">תמחור</h3>

                  <div className="overflow-x-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>סוג</th>
                          <th>שם</th>
                          <th>פירוט</th>
                          <th>סה״כ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {courseItems.map((item, index) => (
                          <tr key={index}>
                            <td>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${item.type === 'project' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                {item.type === 'project' ? 'פרויקט' : 'הדרכה'}
                              </span>
                            </td>
                            <td className="font-medium">{item.courseName || 'לא נבחר'}</td>
                            <td className="text-sm text-gray-500">
                              {item.type === 'project'
                                ? (item.description || 'מחיר כולל')
                                : `${item.groupsCount} קבוצות × ${item.meetingsPerGroup} מפגשים × ₪${item.pricePerMeeting}`
                              }
                            </td>
                            <td className="font-semibold">₪{calculateSubtotal(item).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="border-t pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">סה״כ לפני הנחה:</span>
                      <span className="font-medium">₪{subtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <label className="text-gray-600">הנחה (%):</label>
                      <input
                        type="number"
                        value={discount}
                        onChange={(e) => setDiscount(Math.min(100, Math.max(0, Number(e.target.value))))}
                        className="form-input w-24 text-sm"
                        min="0"
                        max="100"
                      />
                    </div>
                    {discount > 0 && (
                      <div className="flex items-center justify-between text-red-600">
                        <span>הנחה:</span>
                        <span>-₪{discountAmount.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-lg font-bold border-t pt-3">
                      <span>סה״כ:</span>
                      <span className="text-green-600">₪{totalAmount.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Content (AI or Manual) */}
              {currentStep === 4 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold mb-4">תוכן הצעת המחיר</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    ניתן ליצור תוכן אוטומטית עם AI או לכתוב תוכן ידנית. שלב זה אופציונלי — ניתן לדלג.
                  </p>

                  {/* AI Generate Button */}
                  <div className="flex items-center gap-3 mb-4">
                    <button
                      onClick={handleGenerateContent}
                      disabled={isGenerating}
                      className="btn btn-primary"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          מייצר תוכן...
                        </>
                      ) : (
                        <>
                          <Sparkles size={18} />
                          צור תוכן עם AI
                        </>
                      )}
                    </button>
                    {generatedContent && (
                      <span className="text-sm text-green-600">✓ תוכן קיים</span>
                    )}
                  </div>

                  {/* Content Textarea - always visible */}
                  <div>
                    <label className="form-label">תוכן ההצעה (Markdown)</label>
                    <textarea
                      value={generatedContent}
                      onChange={(e) => setGeneratedContent(e.target.value)}
                      className="form-input w-full min-h-[400px] text-sm leading-relaxed font-mono"
                      dir="rtl"
                      placeholder="כתוב כאן את תוכן ההצעה, או לחץ על 'צור תוכן עם AI' למעלה..."
                    />
                  </div>
                </div>
              )}

              {/* Step 5: Preview */}
              {currentStep === 5 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold mb-4">תצוגה מקדימה</h3>

                  {/* Summary */}
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div>
                      <p className="text-sm text-gray-500">מוסד</p>
                      <p className="font-medium">{institution.institutionName}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">איש קשר</p>
                      <p className="font-medium">{institution.contactName}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">סה״כ</p>
                      <p className="font-bold text-green-600 text-lg">₪{totalAmount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">פריטים</p>
                      <p className="font-medium">{courseItems.length} קורסים</p>
                    </div>
                  </div>

                  {/* Generated content preview */}
                  {generatedContent && (
                    <div>
                      <label className="form-label">תוכן ההצעה</label>
                      <div
                        className="bg-white border rounded-lg p-6 text-sm leading-relaxed max-h-[500px] overflow-y-auto prose prose-sm max-w-none"
                        dir="rtl"
                        style={{ whiteSpace: 'pre-wrap' }}
                      >
                        {generatedContent}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Navigation Buttons */}
            <div className="card-footer flex items-center justify-between p-4 border-t">
              <button
                onClick={handleBack}
                disabled={currentStep === 1}
                className="btn btn-secondary"
              >
                <ArrowRight size={18} />
                הקודם
              </button>

              <div className="flex gap-2">
                {currentStep === 5 ? (
                  <>
                    <button
                      onClick={() => handleSave('draft')}
                      disabled={createQuote.isPending}
                      className="btn btn-secondary"
                    >
                      <Save size={18} />
                      {createQuote.isPending ? 'שומר...' : 'שמור כטיוטה'}
                    </button>
                    <button
                      onClick={() => handleSave('sent')}
                      disabled={createQuote.isPending}
                      className="btn btn-primary"
                    >
                      <Send size={18} />
                      {createQuote.isPending ? 'שולח...' : 'שמור ושלח'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleNext}
                    disabled={!canProceed()}
                    className="btn btn-primary"
                  >
                    הבא
                    <ArrowLeft size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
