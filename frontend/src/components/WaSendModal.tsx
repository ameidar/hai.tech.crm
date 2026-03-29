/**
 * WaSendModal — שליחת הודעת WhatsApp (template) ישירות ללקוח
 * ניתן לשימוש מכל מסך — לקוחות, הצעות מחיר, תלמידים וכו'
 */
import React, { useState, useEffect } from 'react';
import { X, FileText, Send, RefreshCw, ChevronDown, ChevronUp, MessageCircle, Plus, CheckCircle, AlertCircle } from 'lucide-react';

interface WaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  text?: string;
}
interface WaTemplate {
  name: string;
  status: string;
  language: string;
  components: WaTemplateComponent[];
}

interface Props {
  phone: string;        // מספר טלפון (ישראלי — 05...)
  contactName: string;  // שם הלקוח לתצוגה
  fromPhoneNumberId?: string; // Phone Number ID to send from (optional, defaults to primary)
  onClose: () => void;
  onSent?: () => void;
}

function authHeaders() {
  const token = localStorage.getItem('accessToken');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/wa${path}`, { headers: authHeaders(), ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return '972' + digits;
}
function getBodyText(tmpl: WaTemplate): string {
  return tmpl.components.find(c => c.type === 'BODY')?.text || '';
}
function countVars(text: string): number {
  return [...new Set(text.match(/\{\{\d+\}\}/g) || [])].length;
}

// ─── Create Template Form ─────────────────────────────────────────────────────
interface CreateForm {
  name: string;
  category: string;
  headerText: string;
  bodyText: string;
  footerText: string;
  exampleValues: string[];
}
const emptyForm: CreateForm = { name: '', category: 'MARKETING', headerText: '', bodyText: '', footerText: '', exampleValues: [] };
function getVarCount(text: string) { return [...new Set(text.match(/\{\{\d+\}\}/g) || [])].length; }

function CreateTemplatePanel({ onCreated }: { onCreated: (name: string) => void }) {
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const set = (k: keyof CreateForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const insertVar = (varNum: number) =>
    setForm(prev => ({ ...prev, bodyText: prev.bodyText + `{{${varNum}}}` }));

  const handleCreate = async () => {
    if (!form.name.trim() || !form.bodyText.trim()) {
      setResult({ success: false, message: 'שם ותוכן הגוף הם שדות חובה' });
      return;
    }
    setCreating(true);
    setResult(null);
    try {
      const resp = await api('/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
          category: form.category,
          headerText: form.headerText.trim() || undefined,
          bodyText: form.bodyText.trim(),
          footerText: form.footerText.trim() || undefined,
          examples: form.exampleValues.filter(Boolean).length > 0 ? form.exampleValues : undefined,
        })
      });
      setResult({ success: true, message: `התבנית נוצרה! סטטוס: ${resp.status || 'PENDING'}. Meta צריכה לאשר (עד 24 שעות).` });
      setForm(emptyForm);
      setTimeout(() => onCreated(resp.name || form.name), 2000);
    } catch (e: any) {
      let msg = 'שגיאה ביצירת תבנית';
      try {
        const parsed = JSON.parse(e.message);
        msg = parsed?.details?.error?.message || parsed?.error || msg;
      } catch {}
      setResult({ success: false, message: msg });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-3">
      <h4 className="font-semibold text-gray-700 flex items-center gap-2">
        <Plus size={16} className="text-blue-500" />
        תבנית חדשה
      </h4>

      {/* Name */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">שם תבנית (אנגלית, קווים תחתיים)</label>
        <input
          type="text"
          value={form.name}
          onChange={set('name')}
          placeholder="לדוגמה: first_message"
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          dir="ltr"
        />
        {form.name && (
          <p className="text-xs text-gray-400 mt-0.5">
            → {form.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}
          </p>
        )}
      </div>

      {/* Category */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">קטגוריה</label>
        <select
          value={form.category}
          onChange={set('category')}
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <option value="MARKETING">MARKETING — שיווקי</option>
          <option value="UTILITY">UTILITY — שירותי / עסקי</option>
        </select>
      </div>

      {/* Header (optional) */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">כותרת עליונה <span className="text-gray-300">(אופציונלי)</span></label>
        <input
          type="text"
          value={form.headerText}
          onChange={set('headerText')}
          placeholder="לדוגמה: דרך ההייטק"
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500">גוף ההודעה *</label>
          <div className="flex gap-1">
            {[1, 2, 3].map(n => (
              <button key={n} onClick={() => insertVar(n)}
                className="text-xs bg-orange-50 text-orange-600 border border-orange-200 rounded px-1.5 py-0.5 hover:bg-orange-100">
                +{`{{${n}}}`}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={form.bodyText}
          onChange={set('bodyText')}
          placeholder={`היי {{1}},\n\nתוכן ההודעה שלך...`}
          rows={5}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
        />
        <p className="text-xs text-gray-400 mt-0.5">
          השתמש ב-{'{{1}}'}, {'{{2}}'} וכו' עבור ערכים דינמיים
        </p>
      </div>

      {/* Example values — required when variables exist */}
      {getVarCount(form.bodyText) > 0 && (
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-3">
          <p className="text-xs font-medium text-orange-700 mb-1">⚠️ ערכי דוגמה — חובה ל-Meta</p>
          {Array.from({ length: getVarCount(form.bodyText) }, (_, i) => (
            <div key={i} className="mb-1.5">
              <label className="text-xs text-orange-600 block mb-0.5">{'{{' + (i + 1) + '}}'}</label>
              <input type="text"
                value={form.exampleValues[i] || ''}
                onChange={e => {
                  const newEx = [...(form.exampleValues || [])];
                  newEx[i] = e.target.value;
                  setForm(prev => ({ ...prev, exampleValues: newEx }));
                }}
                placeholder={i === 0 ? 'יוסי' : i === 1 ? 'רחל' : 'ערך'}
                className="w-full border border-orange-200 bg-white rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-orange-300"
              />
            </div>
          ))}
        </div>
      )}

      {/* Footer (optional) */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">כותרת תחתונה <span className="text-gray-300">(אופציונלי)</span></label>
        <input
          type="text"
          value={form.footerText}
          onChange={set('footerText')}
          placeholder="לדוגמה: www.hai.tech"
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          dir="ltr"
        />
      </div>

      {/* Result */}
      {result && (
        <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {result.success ? <CheckCircle size={16} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />}
          <span>{result.message}</span>
        </div>
      )}

      <button
        onClick={handleCreate}
        disabled={creating || !form.name.trim() || !form.bodyText.trim()}
        className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 text-white rounded-xl py-2.5 font-medium flex items-center justify-center gap-2 transition-colors"
      >
        {creating ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
        {creating ? 'יוצר...' : 'שלח לאישור Meta'}
      </button>

      <p className="text-xs text-gray-400 text-center">
        ⏳ אישור Meta לוקח עד 24 שעות. לאחר אישור התבנית תופיע ברשימה.
      </p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function WaSendModal({ phone, contactName, fromPhoneNumberId, onClose, onSent }: Props) {
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<WaTemplate | null>(null);
  const [templateVars, setTemplateVars] = useState<string[]>([]);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');

  const loadTemplates = () => {
    setLoading(true);
    const qs = fromPhoneNumberId ? `?phoneNumberId=${fromPhoneNumberId}` : '';
    api(`/templates${qs}`)
      .then(data => setTemplates(data))
      .catch(() => alert('שגיאה בטעינת תבניות'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTemplates(); }, []);

  const selectTemplate = (tmpl: WaTemplate) => {
    setSelectedTemplate(tmpl);
    setShowCreate(false);
    const varCount = countVars(getBodyText(tmpl));
    setTemplateVars(Array(varCount).fill(''));
  };

  const renderPreview = (): string => {
    if (!selectedTemplate) return '';
    let text = getBodyText(selectedTemplate);
    templateVars.forEach((v, i) => {
      text = text.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), v || `{{${i + 1}}}`);
    });
    return text;
  };

  const sendTemplate = async () => {
    if (!selectedTemplate) return;
    setSending(true);
    try {
      await api('/send-template', {
        method: 'POST',
        body: JSON.stringify({
          phone: normalizePhone(phone),
          contactName,
          templateName: selectedTemplate.name,
          language: selectedTemplate.language,
          variables: templateVars,
          previewText: renderPreview(),
          ...(fromPhoneNumberId && { fromPhoneNumberId })
        })
      });
      setSent(true);
      setTimeout(() => { onSent?.(); onClose(); }, 1500);
    } catch {
      alert('שגיאה בשליחת ההודעה. ודא שהמספר תקין.');
    } finally {
      setSending(false);
    }
  };

  const normalizedDisplay = phone.replace(/\D/g, '').replace(/^972/, '0');

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
              <MessageCircle size={16} className="text-green-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-800">שלח WhatsApp</h3>
              <p className="text-xs text-gray-500">{contactName} · {normalizedDisplay}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {sent ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <MessageCircle size={32} className="text-green-500" />
            </div>
            <p className="text-green-700 font-semibold text-lg">ההודעה נשלחה!</p>
            <p className="text-gray-500 text-sm">השיחה תופיע ב-WhatsApp Inbox</p>
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-gray-400">
            <RefreshCw size={18} className="animate-spin" />
            <span>טוען תבניות...</span>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Template list */}
            <div className="w-1/2 border-l border-gray-100 flex flex-col overflow-hidden">
              {/* Create new button */}
              <button
                onClick={() => { setShowCreate(true); setSelectedTemplate(null); }}
                className={`flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 text-sm font-medium transition-colors ${showCreate ? 'bg-blue-50 text-blue-600' : 'text-blue-500 hover:bg-blue-50'}`}
              >
                <Plus size={15} />
                תבנית חדשה
              </button>

              {/* Approved templates */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-3 py-2 border-b border-gray-100">
                  <input
                    type="text"
                    value={templateSearch}
                    onChange={e => setTemplateSearch(e.target.value)}
                    placeholder="חיפוש תבנית..."
                    dir="rtl"
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                </div>
                <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                  <p className="text-xs text-gray-400 font-medium">תבניות מאושרות ({templates.filter(t => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())).length})</p>
                </div>
                {templates.filter(t => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())).map(tmpl => {
                  const body = getBodyText(tmpl);
                  const varCount = countVars(body);
                  const isSelected = !showCreate && selectedTemplate?.name === tmpl.name;
                  const isExpanded = expandedTemplate === tmpl.name;
                  return (
                    <div key={tmpl.name}
                      className={`border-b border-gray-100 cursor-pointer transition-colors ${isSelected ? 'bg-green-50 border-r-2 border-r-green-400' : 'hover:bg-gray-50'}`}
                      onClick={() => selectTemplate(tmpl)}
                    >
                      <div className="px-3 py-2.5 flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {tmpl.name.replace(/_/g, ' ')}
                          </p>
                          {varCount > 0 && (
                            <span className="text-xs text-orange-500">{varCount} משתנים</span>
                          )}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); setExpandedTemplate(isExpanded ? null : tmpl.name); }}
                          className="p-0.5 text-gray-400 hover:text-gray-600 flex-shrink-0">
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>
                      {isExpanded && body && (
                        <div className="px-3 pb-2.5">
                          <p className="text-xs text-gray-500 whitespace-pre-wrap bg-gray-50 rounded p-2 leading-relaxed">
                            {body.slice(0, 200)}{body.length > 200 ? '...' : ''}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right panel */}
            <div className="w-1/2 flex flex-col overflow-hidden">
              {showCreate ? (
                <CreateTemplatePanel onCreated={(name) => {
                  setShowCreate(false);
                  loadTemplates();
                }} />
              ) : selectedTemplate ? (
                <div className="flex flex-col p-4 h-full overflow-y-auto">
                  <h4 className="font-semibold text-gray-700 mb-3 text-sm">
                    {selectedTemplate.name.replace(/_/g, ' ')}
                  </h4>

                  {templateVars.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-medium text-gray-500 mb-2">מלא את המשתנים:</p>
                      {templateVars.map((v, i) => (
                        <div key={i} className="mb-2">
                          <label className="text-xs text-gray-400 block mb-1">{'{{' + (i + 1) + '}}'}</label>
                          <input
                            type="text"
                            value={v}
                            onChange={e => {
                              const newVars = [...templateVars];
                              newVars[i] = e.target.value;
                              setTemplateVars(newVars);
                            }}
                            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                            placeholder={`ערך ${i + 1}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex-1">
                    <p className="text-xs font-medium text-gray-500 mb-2">תצוגה מקדימה:</p>
                    <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                      {renderPreview()}
                    </div>
                  </div>

                  <button
                    onClick={sendTemplate}
                    disabled={sending}
                    className="mt-4 w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-200 text-white rounded-xl py-2.5 font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    {sending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                    {sending ? 'שולח...' : `שלח ל-${normalizedDisplay}`}
                  </button>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <FileText size={32} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">בחר תבנית מהרשימה</p>
                    <p className="text-xs mt-1 text-gray-300">או צור תבנית חדשה</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
