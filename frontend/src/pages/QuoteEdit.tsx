import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, Save, Loader2, Plus, Trash2, Sparkles } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { quotesApi } from '../api/quotes';
import { fetchData } from '../hooks/useApi';
import PageHeader from '../components/ui/PageHeader';
import Loading from '../components/ui/Loading';
import type { Course, Branch } from '../types';

type ItemType = 'education' | 'project';

interface CourseItem {
  id?: string;
  type: ItemType;
  courseId: string;
  courseName: string;
  description: string;
  groupsCount: number;
  meetingsPerGroup: number;
  durationMinutes: number;
  pricePerMeeting: number;
  totalPrice: number;
}

export default function QuoteEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [institutionName, setInstitutionName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [branchId, setBranchId] = useState('');
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState(0);
  const [courseItems, setCourseItems] = useState<CourseItem[]>([]);
  const [generatedContent, setGeneratedContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [clientType, setClientType] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [payingBodyName, setPayingBodyName] = useState('');
  const [payingBodyPhone, setPayingBodyPhone] = useState('');
  const [payingBodyEmail, setPayingBodyEmail] = useState('');
  const [payingBodyNotes, setPayingBodyNotes] = useState('');

  const { data: quote, isLoading } = useQuery({
    queryKey: ['quote', id],
    queryFn: () => quotesApi.get(id!),
    enabled: !!id,
  });

  const { data: courses } = useQuery({
    queryKey: ['courses'],
    queryFn: () => fetchData<Course[]>('/courses'),
  });

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => fetchData<Branch[]>('/branches'),
  });

  const updateQuote = useMutation({
    mutationFn: (data: any) => quotesApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quote', id] });
      navigate(`/quotes/${id}`);
    },
  });

  // Populate form from quote data
  useEffect(() => {
    if (quote) {
      setInstitutionName(quote.institutionName || '');
      setContactName(quote.contactName || '');
      setContactPhone(quote.contactPhone || '');
      setContactEmail(quote.contactEmail || '');
      setContactRole(quote.contactRole || '');
      setBranchId(quote.branchId || '');
      setNotes(quote.notes || '');
      setClientType((quote as any).clientType || '');
      setCustomerId((quote as any).customerId || '');
      setPayingBodyName((quote as any).payingBodyName || '');
      setPayingBodyPhone((quote as any).payingBodyPhone || '');
      setPayingBodyEmail((quote as any).payingBodyEmail || '');
      setPayingBodyNotes((quote as any).payingBodyNotes || '');

      // Handle discount - could be percentage or flat amount
      const discountVal = Number(quote.discount || 0);
      setDiscount(discountVal);

      // Content
      const content = quote.content || quote.generatedContent;
      if (typeof content === 'object' && content !== null && 'markdown' in (content as any)) {
        setGeneratedContent((content as any).markdown);
      } else if (typeof content === 'string') {
        setGeneratedContent(content);
      }

      // Items
      if (quote.items && quote.items.length > 0) {
        setCourseItems(quote.items.map((item: any) => {
          const isProject = item.groups === 1 && item.meetingsPerGroup === 1 && item.description;
          return {
            id: item.id,
            type: isProject ? 'project' as ItemType : 'education' as ItemType,
            courseId: item.courseId || '',
            courseName: item.courseName || '',
            description: item.description || '',
            groupsCount: item.groups || 1,
            meetingsPerGroup: item.meetingsPerGroup || 1,
            durationMinutes: item.meetingDuration || 90,
            pricePerMeeting: Number(item.pricePerMeeting || 0),
            totalPrice: Number(item.subtotal || 0),
          };
        }));
      }
    }
  }, [quote]);

  const calculateSubtotal = (item: CourseItem) =>
    item.type === 'project' ? item.totalPrice : item.groupsCount * item.meetingsPerGroup * item.pricePerMeeting;

  const subtotal = courseItems.reduce((sum, item) => sum + calculateSubtotal(item), 0);
  const finalAmount = subtotal - discount;

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
        institutionName,
        contactName,
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

  const handleSave = async () => {
    const data = {
      institutionName,
      contactName,
      contactPhone: contactPhone || undefined,
      contactEmail: contactEmail || undefined,
      contactRole: contactRole || undefined,
      branchId: branchId || undefined,
      clientType: clientType || undefined,
      customerId: customerId || undefined,
      payingBodyName: payingBodyName || undefined,
      payingBodyPhone: payingBodyPhone || undefined,
      payingBodyEmail: payingBodyEmail || undefined,
      payingBodyNotes: payingBodyNotes || undefined,
      notes: notes || undefined,
      discount,
      content: generatedContent ? { markdown: generatedContent } : undefined,
      items: courseItems.map((item) => ({
        id: item.id,
        courseId: item.courseId || undefined,
        courseName: item.courseName,
        description: item.description || undefined,
        groups: item.type === 'project' ? 1 : item.groupsCount,
        meetingsPerGroup: item.type === 'project' ? 1 : item.meetingsPerGroup,
        meetingDuration: item.durationMinutes,
        pricePerMeeting: item.type === 'project' ? item.totalPrice : item.pricePerMeeting,
      })),
    };

    try {
      await updateQuote.mutateAsync(data);
    } catch (error) {
      console.error('Failed to update quote:', error);
      alert('שגיאה בעדכון ההצעה');
    }
  };

  if (isLoading) {
    return <Loading size="lg" text="טוען הצעת מחיר..." />;
  }

  return (
    <>
      <PageHeader
        title={`עריכת הצעה ${quote?.quoteNumber || ''}`}
        actions={
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={updateQuote.isPending}
              className="btn btn-primary"
            >
              {updateQuote.isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              {updateQuote.isPending ? 'שומר...' : 'שמור'}
            </button>
            <button onClick={() => navigate(`/quotes/${id}`)} className="btn btn-secondary">
              <ArrowRight size={18} />
              חזרה
            </button>
          </div>
        }
      />

      <div className="flex-1 p-4 md:p-6 overflow-auto">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Section 1: Institution Details */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold">פרטי מוסד / לקוח</h3>
            </div>
            <div className="card-body p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="col-span-2 md:col-span-1">
                  <label className="form-label">שם המוסד / לקוח *</label>
                  <input
                    type="text"
                    value={institutionName}
                    onChange={(e) => setInstitutionName(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">קישור לסניף</label>
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
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
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">תפקיד</label>
                  <input
                    type="text"
                    value={contactRole}
                    onChange={(e) => setContactRole(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">טלפון</label>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="form-input"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="form-label">אימייל</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="form-input"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Paying Body */}
              <details className="border rounded-lg p-4">
                <summary className="cursor-pointer font-medium text-gray-700">גוף משלם (אופציונלי)</summary>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="form-label">שם גוף משלם</label>
                    <input
                      type="text"
                      value={payingBodyName}
                      onChange={(e) => setPayingBodyName(e.target.value)}
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">טלפון</label>
                    <input
                      type="tel"
                      value={payingBodyPhone}
                      onChange={(e) => setPayingBodyPhone(e.target.value)}
                      className="form-input"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="form-label">מייל</label>
                    <input
                      type="email"
                      value={payingBodyEmail}
                      onChange={(e) => setPayingBodyEmail(e.target.value)}
                      className="form-input"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="form-label">הערות</label>
                    <input
                      type="text"
                      value={payingBodyNotes}
                      onChange={(e) => setPayingBodyNotes(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              </details>
            </div>
          </div>

          {/* Section 2: Items */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h3 className="font-semibold">פריטי ההצעה</h3>
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
            <div className="card-body p-6 space-y-4">
              {courseItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>לא נוספו פריטים</p>
                </div>
              ) : (
                courseItems.map((item, index) => (
                  <div key={index} className={`border rounded-lg p-4 ${item.type === 'project' ? 'border-purple-200 bg-purple-50/30' : 'border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.type === 'project' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {item.type === 'project' ? 'פרויקט / שירות' : 'הדרכה / קורס'}
                        </span>
                        <h4 className="font-medium text-gray-700">פריט {index + 1}</h4>
                      </div>
                      <button onClick={() => removeCourseItem(index)} className="icon-btn icon-btn-danger" title="הסר">
                        <Trash2 size={16} />
                      </button>
                    </div>

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
                        />
                      </div>
                    </div>

                    {item.type === 'education' ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div>
                          <label className="form-label text-xs">קבוצות *</label>
                          <input type="number" value={item.groupsCount} onChange={(e) => updateCourseItem(index, 'groupsCount', Number(e.target.value))} className="form-input text-sm" min="1" />
                        </div>
                        <div>
                          <label className="form-label text-xs">מפגשים לקבוצה *</label>
                          <input type="number" value={item.meetingsPerGroup} onChange={(e) => updateCourseItem(index, 'meetingsPerGroup', Number(e.target.value))} className="form-input text-sm" min="1" />
                        </div>
                        <div>
                          <label className="form-label text-xs">משך (דקות)</label>
                          <input type="number" value={item.durationMinutes} onChange={(e) => updateCourseItem(index, 'durationMinutes', Number(e.target.value))} className="form-input text-sm" min="30" step="15" />
                        </div>
                        <div>
                          <label className="form-label text-xs">מחיר למפגש (₪) *</label>
                          <input type="number" value={item.pricePerMeeting} onChange={(e) => updateCourseItem(index, 'pricePerMeeting', Number(e.target.value))} className="form-input text-sm" min="0" />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="form-label text-xs">מחיר כולל (₪) *</label>
                          <input type="number" value={item.totalPrice} onChange={(e) => updateCourseItem(index, 'totalPrice', Number(e.target.value))} className="form-input text-sm" min="0" />
                        </div>
                      </div>
                    )}

                    <div className="mt-2 text-left text-sm text-gray-500">
                      סה״כ: <span className="font-semibold text-green-600">₪{calculateSubtotal(item).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Section 3: Pricing Summary */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold">תמחור</h3>
            </div>
            <div className="card-body p-6 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">סה״כ לפני הנחה:</span>
                <span className="font-medium">₪{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <label className="text-gray-600">הנחה (₪):</label>
                <input
                  type="number"
                  value={discount}
                  onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
                  className="form-input w-32 text-sm"
                  min="0"
                />
              </div>
              <div className="flex items-center justify-between text-lg font-bold border-t pt-3">
                <span>סה״כ:</span>
                <span className="text-green-600">₪{finalAmount.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Section 4: Content */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h3 className="font-semibold">תוכן ההצעה</h3>
              <button
                onClick={handleGenerateContent}
                disabled={isGenerating}
                className="btn btn-primary text-sm"
              >
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {isGenerating ? 'מייצר...' : 'צור תוכן עם AI'}
              </button>
            </div>
            <div className="card-body p-6">
              <textarea
                value={generatedContent}
                onChange={(e) => setGeneratedContent(e.target.value)}
                className="form-input w-full min-h-[300px] text-sm leading-relaxed font-mono"
                dir="rtl"
                placeholder="כתוב כאן את תוכן ההצעה..."
              />
            </div>
          </div>

          {/* Section 5: Notes */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold">הערות</h3>
            </div>
            <div className="card-body p-6">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="form-input w-full min-h-[100px] text-sm"
                dir="rtl"
                placeholder="הערות פנימיות..."
              />
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
