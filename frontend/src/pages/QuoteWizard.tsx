import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Check, Loader2, Plus, Trash2, Sparkles, Save, Send } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { quotesApi, type QuoteItem, type CreateQuoteData } from '../api/quotes';
import { fetchData } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import type { Course, Branch } from '../types';

const steps = [
  { label: 'פרטי מוסד', number: 1 },
  { label: 'בחירת קורסים', number: 2 },
  { label: 'תמחור', number: 3 },
  { label: 'תוכן AI', number: 4 },
  { label: 'תצוגה מקדימה', number: 5 },
];

interface InstitutionData {
  institutionName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  contactRole: string;
  branchId: string;
}

interface CourseItem {
  courseId: string;
  courseName: string;
  groupsCount: number;
  meetingsPerGroup: number;
  durationMinutes: number;
  pricePerMeeting: number;
}

export default function QuoteWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1
  const [institution, setInstitution] = useState<InstitutionData>({
    institutionName: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    contactRole: '',
    branchId: '',
  });

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

  const createQuote = useMutation({
    mutationFn: (data: CreateQuoteData) => quotesApi.create(data),
    onSuccess: (quote) => {
      navigate(`/quotes/${quote.id}`);
    },
  });

  // Calculate totals
  const calculateSubtotal = (item: CourseItem) =>
    item.groupsCount * item.meetingsPerGroup * item.pricePerMeeting;

  const subtotal = courseItems.reduce((sum, item) => sum + calculateSubtotal(item), 0);
  const discountAmount = (subtotal * discount) / 100;
  const totalAmount = subtotal - discountAmount;

  // Validation
  const isStep1Valid = institution.institutionName && institution.contactName;
  const isStep2Valid = courseItems.length > 0 && courseItems.every(
    (item) => item.courseId && item.groupsCount > 0 && item.meetingsPerGroup > 0 && item.pricePerMeeting > 0
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

  const addCourseItem = () => {
    setCourseItems([...courseItems, {
      courseId: '',
      courseName: '',
      groupsCount: 1,
      meetingsPerGroup: 12,
      durationMinutes: 90,
      pricePerMeeting: 0,
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
          courseName: item.courseName,
          groupsCount: item.groupsCount,
          meetingsPerGroup: item.meetingsPerGroup,
          durationMinutes: item.durationMinutes,
          pricePerMeeting: item.pricePerMeeting,
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
    const data: CreateQuoteData = {
      institutionName: institution.institutionName,
      contactName: institution.contactName,
      contactPhone: institution.contactPhone || undefined,
      contactEmail: institution.contactEmail || undefined,
      contactRole: institution.contactRole || undefined,
      branchId: institution.branchId || undefined,
      items: courseItems.map((item) => ({
        courseId: item.courseId,
        groupsCount: item.groupsCount,
        meetingsPerGroup: item.meetingsPerGroup,
        durationMinutes: item.durationMinutes,
        pricePerMeeting: item.pricePerMeeting,
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
                  <h3 className="text-lg font-semibold mb-4">פרטי המוסד</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="col-span-2 md:col-span-1">
                      <label className="form-label">שם המוסד *</label>
                      <input
                        type="text"
                        value={institution.institutionName}
                        onChange={(e) => setInstitution({ ...institution, institutionName: e.target.value })}
                        className="form-input"
                        placeholder="לדוגמה: בית ספר אורט"
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label">קישור לסניף (אופציונלי)</label>
                      <select
                        value={institution.branchId}
                        onChange={(e) => setInstitution({ ...institution, branchId: e.target.value })}
                        className="form-input"
                      >
                        <option value="">ללא קישור</option>
                        {branches?.map((branch) => (
                          <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                      </select>
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
                      <label className="form-label">טלפון</label>
                      <input
                        type="tel"
                        value={institution.contactPhone}
                        onChange={(e) => setInstitution({ ...institution, contactPhone: e.target.value })}
                        className="form-input"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="form-label">אימייל</label>
                      <input
                        type="email"
                        value={institution.contactEmail}
                        onChange={(e) => setInstitution({ ...institution, contactEmail: e.target.value })}
                        className="form-input"
                        dir="ltr"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Course Selection */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">בחירת קורסים</h3>
                    <button onClick={addCourseItem} className="btn btn-primary text-sm">
                      <Plus size={16} />
                      הוסף קורס
                    </button>
                  </div>

                  {courseItems.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <p className="mb-4">לא נבחרו קורסים</p>
                      <button onClick={addCourseItem} className="btn btn-primary">
                        <Plus size={16} />
                        הוסף קורס ראשון
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {courseItems.map((item, index) => (
                        <div key={index} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="font-medium text-gray-700">קורס {index + 1}</h4>
                            <button
                              onClick={() => removeCourseItem(index)}
                              className="icon-btn icon-btn-danger"
                              title="הסר"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            <div className="col-span-2 md:col-span-1">
                              <label className="form-label text-xs">קורס *</label>
                              <select
                                value={item.courseId}
                                onChange={(e) => updateCourseItem(index, 'courseId', e.target.value)}
                                className="form-input text-sm"
                                required
                              >
                                <option value="">בחר קורס</option>
                                {courses?.map((course) => (
                                  <option key={course.id} value={course.id}>{course.name}</option>
                                ))}
                              </select>
                            </div>
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
                          <th>קורס</th>
                          <th>קבוצות</th>
                          <th>מפגשים</th>
                          <th>מחיר למפגש</th>
                          <th>סה״כ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {courseItems.map((item, index) => (
                          <tr key={index}>
                            <td className="font-medium">{item.courseName || 'לא נבחר'}</td>
                            <td>{item.groupsCount}</td>
                            <td>{item.meetingsPerGroup}</td>
                            <td>₪{item.pricePerMeeting.toLocaleString()}</td>
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

              {/* Step 4: AI Content */}
              {currentStep === 4 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold mb-4">יצירת תוכן עם AI</h3>

                  {!generatedContent ? (
                    <div className="text-center py-12">
                      <Sparkles size={48} className="mx-auto mb-4 text-purple-400" />
                      <p className="text-gray-500 mb-6">
                        לחצו על הכפתור כדי ליצור הצעת מחיר מקצועית באמצעות בינה מלאכותית
                      </p>
                      <button
                        onClick={handleGenerateContent}
                        disabled={isGenerating}
                        className="btn btn-primary text-lg px-8 py-3"
                      >
                        {isGenerating ? (
                          <>
                            <Loader2 size={20} className="animate-spin" />
                            יוצר תוכן...
                          </>
                        ) : (
                          <>
                            <Sparkles size={20} />
                            צור תוכן הצעה
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm text-gray-500">התוכן נוצר בהצלחה</span>
                        <button
                          onClick={handleGenerateContent}
                          disabled={isGenerating}
                          className="btn btn-secondary text-sm"
                        >
                          {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          צור מחדש
                        </button>
                      </div>
                      <div className="bg-gray-50 border rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed max-h-96 overflow-y-auto">
                        {generatedContent}
                      </div>
                    </div>
                  )}
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

                  {/* Editable content */}
                  {generatedContent && (
                    <div>
                      <label className="form-label">תוכן ההצעה (ניתן לעריכה)</label>
                      <textarea
                        value={generatedContent}
                        onChange={(e) => setGeneratedContent(e.target.value)}
                        className="form-input min-h-[300px] text-sm whitespace-pre-wrap"
                        dir="rtl"
                      />
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
