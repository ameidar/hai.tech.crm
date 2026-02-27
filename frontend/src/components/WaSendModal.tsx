/**
 * WaSendModal — שליחת הודעת WhatsApp (template) ישירות ללקוח
 * ניתן לשימוש מכל מסך — לקוחות, הצעות מחיר, תלמידים וכו'
 */
import React, { useState, useEffect } from 'react';
import { X, FileText, Send, RefreshCw, ChevronDown, ChevronUp, MessageCircle } from 'lucide-react';

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
  onClose: () => void;
  onSent?: () => void;  // קולבק אחרי שליחה מוצלחת
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
  const matches = text.match(/\{\{\d+\}\}/g) || [];
  return [...new Set(matches)].length;
}

export default function WaSendModal({ phone, contactName, onClose, onSent }: Props) {
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<WaTemplate | null>(null);
  const [templateVars, setTemplateVars] = useState<string[]>([]);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api('/templates')
      .then(data => setTemplates(data))
      .catch(() => alert('שגיאה בטעינת תבניות'))
      .finally(() => setLoading(false));
  }, []);

  const selectTemplate = (tmpl: WaTemplate) => {
    setSelectedTemplate(tmpl);
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
          previewText: renderPreview()
        })
      });
      setSent(true);
      setTimeout(() => {
        onSent?.();
        onClose();
      }, 1500);
    } catch (e: any) {
      alert('שגיאה בשליחת ההודעה. ודא שהמספר תקין.');
    } finally {
      setSending(false);
    }
  };

  const normalizedDisplay = phone.replace(/\D/g, '').replace(/^972/, '0');

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">

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
            <div className="w-1/2 border-l border-gray-100 overflow-y-auto">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                <p className="text-xs text-gray-500 font-medium">בחר תבנית ({templates.length})</p>
              </div>
              {templates.map(tmpl => {
                const body = getBodyText(tmpl);
                const varCount = countVars(body);
                const isSelected = selectedTemplate?.name === tmpl.name;
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

            {/* Right panel */}
            <div className="w-1/2 flex flex-col p-4 overflow-y-auto">
              {selectedTemplate ? (
                <>
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
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <FileText size={32} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">בחר תבנית מהרשימה</p>
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
