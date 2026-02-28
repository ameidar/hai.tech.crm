import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageCircle, Send, Bot, User, RefreshCw, Check, CheckCheck, Clock, PhoneCall, X, FileText, ChevronDown, ChevronUp, Search, PenSquare, Plus, CheckCircle, AlertCircle, CreditCard } from 'lucide-react';
import WaSendModal from '../components/WaSendModal';
import WooPayModal from '../components/WooPayModal';

// ─── Types ──────────────────────────────────────────────────────────────────
interface WaConversation {
  id: string;
  phone: string;
  contactName?: string;
  status: 'open' | 'pending' | 'closed';
  unreadCount: number;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  leadName?: string;
  leadEmail?: string;
  childName?: string;
  childAge?: number;
  interests?: string;
  leadType?: string;
  summary?: string;
  aiEnabled: boolean;
  businessPhone?: string;
  phoneNumberId?: string;
  createdAt: string;
}

interface WaMessage {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  waMessageId?: string;
  status: string;
  tokensUsed?: number;
  isAiGenerated: boolean;
  createdAt: string;
}

interface WaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  text?: string;
}
interface WaTemplate {
  id?: string;
  name: string;
  status: string;
  language: string;
  components: WaTemplateComponent[];
}

// ─── API helpers ─────────────────────────────────────────────────────────────
const BASE = '/api/wa';
function authHeaders() {
  const token = localStorage.getItem('accessToken');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders(), ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── Format helpers ───────────────────────────────────────────────────────────
function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

function formatPhone(phone: string) {
  return phone.replace(/^972/, '0').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
}

// ─── Message status icon ──────────────────────────────────────────────────────
function StatusIcon({ status }: { status: string }) {
  if (status === 'read') return <CheckCheck size={14} className="text-blue-400" />;
  if (status === 'delivered') return <CheckCheck size={14} className="text-gray-400" />;
  if (status === 'sent') return <Check size={14} className="text-gray-400" />;
  return <Clock size={14} className="text-gray-300" />;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function WhatsAppInbox() {
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [selected, setSelected] = useState<WaConversation | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<WaTemplate | null>(null);
  const [templateVars, setTemplateVars] = useState<string[]>([]);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  // Top-level view mode
  const [viewMode, setViewMode] = useState<'inbox' | 'templates'>('inbox');
  // Template Manager state (top-level)
  const [tmplMgrTab, setTmplMgrTab] = useState<'list' | 'create'>('list');
  // Create template (inside template modal)
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', category: 'MARKETING', headerText: '', bodyText: '', footerText: '' });
  const [exampleValues, setExampleValues] = useState<string[]>([]);
  // Auto-sync example values count to variable count in body
  const getVarCount = (text: string) => [...new Set(text.match(/\{\{\d+\}\}/g) || [])].length;
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ success: boolean; message: string } | null>(null);
  // New conversation
  const [showNewConv, setShowNewConv] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [newConvTarget, setNewConvTarget] = useState<{ phone: string; name: string } | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');
  const [showPayModal, setShowPayModal] = useState(false);
  const [activePhones, setActivePhones] = useState<{ phoneNumberId: string; businessPhone: string; label: string }[]>([]);
  const [selectedFromPhone, setSelectedFromPhone] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const data = await api('/conversations');
      setConversations(data);
    } catch (e) {
      console.error('Failed to load conversations', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load messages for selected conversation
  const loadMessages = useCallback(async (convId: string) => {
    try {
      const data = await api(`/conversations/${convId}/messages`);
      setMessages(data);
      // Mark as read locally
      setConversations(prev => prev.map(c =>
        c.id === convId ? { ...c, unreadCount: 0 } : c
      ));
    } catch (e) {
      console.error('Failed to load messages', e);
    }
  }, []);

  // SSE real-time updates
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const es = new EventSource(`/api/wa/events?token=${token}`);
    eventSourceRef.current = es;

    es.addEventListener('new_message', (e: MessageEvent) => {
      const { conversationId, message } = JSON.parse(e.data);
      // Update messages if in active conversation
      setSelected(prev => {
        if (prev?.id === conversationId) {
          setMessages(msgs => [...msgs, message]);
        }
        return prev;
      });
      // Update conversation preview — or fetch full list if conversation is new
      setConversations(prev => {
        const exists = prev.some(c => c.id === conversationId);
        if (!exists) {
          // New conversation arrived — reload full list
          loadConversations();
          return prev;
        }
        return prev.map(c => {
          if (c.id !== conversationId) return c;
          return {
            ...c,
            lastMessagePreview: message.content.slice(0, 80),
            lastMessageAt: message.createdAt,
            unreadCount: message.direction === 'inbound' ? c.unreadCount + 1 : c.unreadCount
          };
        });
      });
    });

    es.addEventListener('conversation_updated', (e: MessageEvent) => {
      const updated = JSON.parse(e.data);
      setConversations(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
      setSelected(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
    });

    es.addEventListener('message_status', (e: MessageEvent) => {
      const { waMessageId, status } = JSON.parse(e.data);
      setMessages(prev => prev.map(m => m.waMessageId === waMessageId ? { ...m, status } : m));
    });

    return () => es.close();
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Auto-select conversation from URL param (?conv=<id>)
  useEffect(() => {
    const convId = searchParams.get('conv');
    if (convId && conversations.length > 0) {
      const target = conversations.find(c => c.id === convId);
      if (target) setSelected(target);
    }
  }, [searchParams, conversations]);

  // Load active phones for multi-number support
  useEffect(() => {
    api('/phones').then(data => {
      setActivePhones(data);
      if (data.length > 0) setSelectedFromPhone(data[0].phoneNumberId);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (selected) loadMessages(selected.id);
  }, [selected, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectConversation = (conv: WaConversation) => {
    setSelected(conv);
    setMessages([]);
  };

  const sendMessage = async () => {
    if (!selected || !input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    try {
      await api('/send', {
        method: 'POST',
        body: JSON.stringify({ conversationId: selected.id, text })
      });
    } catch (e) {
      alert('שגיאה בשליחת הודעה');
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const toggleAI = async (conv: WaConversation) => {
    const updated = await api(`/conversations/${conv.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ aiEnabled: !conv.aiEnabled })
    });
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, ...updated } : c));
    if (selected?.id === conv.id) setSelected(s => s ? { ...s, aiEnabled: !s.aiEnabled } : s);
  };

  const closeConversation = async (conv: WaConversation) => {
    await api(`/conversations/${conv.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: conv.status === 'closed' ? 'open' : 'closed' })
    });
    loadConversations();
  };

  // Customer search for new conversation
  const searchCustomers = useCallback(async (q: string) => {
    if (!q.trim()) { setCustomerResults([]); return; }
    setSearchingCustomers(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/customers?search=${encodeURIComponent(q)}&limit=10`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setCustomerResults(Array.isArray(data) ? data : (data.data || []));
    } catch { setCustomerResults([]); }
    finally { setSearchingCustomers(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchCustomers(customerSearch), 300);
    return () => clearTimeout(timer);
  }, [customerSearch, searchCustomers]);

  const loadTemplates = async (forceReload = false, phoneNumberId?: string) => {
    if (templates.length > 0 && !forceReload) { setShowTemplateModal(true); return; }
    setLoadingTemplates(true);
    try {
      const pid = phoneNumberId || selected?.phoneNumberId || selectedFromPhone || '';
      const qs = pid ? `?phoneNumberId=${pid}` : '';
      const data = await api(`/templates${qs}`);
      setTemplates(data);
      setShowTemplateModal(true);
    } catch (e) {
      alert('שגיאה בטעינת תבניות');
    } finally {
      setLoadingTemplates(false);
    }
  };

  const submitCreateTemplate = async () => {
    if (!createForm.name.trim() || !createForm.bodyText.trim()) {
      setCreateResult({ success: false, message: 'שם ותוכן הגוף הם שדות חובה' });
      return;
    }
    setCreating(true);
    setCreateResult(null);
    try {
      const resp = await api('/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: createForm.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
          category: createForm.category,
          headerText: createForm.headerText.trim() || undefined,
          bodyText: createForm.bodyText.trim(),
          footerText: createForm.footerText.trim() || undefined,
          examples: exampleValues.filter(Boolean).length > 0 ? exampleValues : undefined,
          phoneNumberId: selectedFromPhone || undefined,
        })
      });
      setCreateResult({ success: true, message: `נוצר! סטטוס: ${resp.status || 'PENDING'}. Meta תאשר עד 24 שעות.` });
      setCreateForm({ name: '', category: 'MARKETING', headerText: '', bodyText: '', footerText: '' });
      setExampleValues([]);
      setTimeout(() => { setShowCreateTemplate(false); setCreateResult(null); loadTemplates(true); }, 2500);
    } catch (e: any) {
      let msg = 'שגיאה ביצירת תבנית';
      try { const p = JSON.parse(e.message); msg = p?.details?.error?.message || p?.error || msg; } catch {}
      setCreateResult({ success: false, message: msg });
    } finally {
      setCreating(false);
    }
  };

  const getBodyText = (tmpl: WaTemplate) =>
    tmpl.components.find(c => c.type === 'BODY')?.text || '';

  const countVars = (text: string) => {
    const matches = text.match(/\{\{\d+\}\}/g) || [];
    return [...new Set(matches)].length;
  };

  const selectTemplate = (tmpl: WaTemplate) => {
    setSelectedTemplate(tmpl);
    const body = getBodyText(tmpl);
    const varCount = countVars(body);
    setTemplateVars(Array(varCount).fill(''));
  };

  const renderPreview = () => {
    if (!selectedTemplate) return '';
    let text = getBodyText(selectedTemplate);
    templateVars.forEach((v, i) => {
      text = text.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), v || `{{${i + 1}}}`);
    });
    return text;
  };

  const sendTemplate = async () => {
    if (!selected || !selectedTemplate) return;
    setSending(true);
    try {
      await api('/send-template', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: selected.id,
          templateName: selectedTemplate.name,
          language: selectedTemplate.language,
          variables: templateVars,
          previewText: renderPreview()
        })
      });
      setShowTemplateModal(false);
      setSelectedTemplate(null);
      setTemplateVars([]);
    } catch (e) {
      alert('שגיאה בשליחת תבנית');
    } finally {
      setSending(false);
    }
  };

  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-gray-50 overflow-hidden" dir="rtl">

      {/* ── Top Tab Bar ── */}
      <div className="bg-white border-b border-gray-200 flex items-center gap-1 px-4 flex-shrink-0">
        <button
          onClick={() => setViewMode('inbox')}
          className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${viewMode === 'inbox' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <MessageCircle size={16} />
          שיחות
          {totalUnread > 0 && (
            <span className="bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{totalUnread}</span>
          )}
        </button>
        <button
          onClick={() => { setViewMode('templates'); setTmplMgrTab('list'); if (templates.length === 0) loadTemplates(); }}
          className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${viewMode === 'templates' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <FileText size={16} />
          ניהול תבניות
        </button>
      </div>

      {/* ── Template Manager View ── */}
      {viewMode === 'templates' && (
        <div className="flex flex-1 overflow-hidden">
          {/* Template list */}
          <div className="w-72 bg-white border-l border-gray-200 flex flex-col flex-shrink-0">
            <div className="p-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">{templates.length} תבניות מאושרות</span>
              <button
                onClick={() => setTmplMgrTab('create')}
                className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 font-medium"
              >
                <Plus size={14} /> חדשה
              </button>
            </div>
            <div className="px-3 py-2 border-b border-gray-100">
              <input
                type="text"
                value={templateSearch}
                onChange={e => setTemplateSearch(e.target.value)}
                placeholder="חיפוש תבנית..."
                dir="rtl"
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingTemplates ? (
                <div className="flex items-center justify-center p-6 text-gray-400 gap-2">
                  <RefreshCw size={16} className="animate-spin" /> טוען...
                </div>
              ) : templates.filter(t => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())).map(tmpl => {
                const body = getBodyText(tmpl);
                const varCount = countVars(body);
                return (
                  <div key={tmpl.name}
                    onClick={() => { setSelectedTemplate(tmpl); setTmplMgrTab('list'); }}
                    className={`border-b border-gray-100 cursor-pointer px-3 py-3 hover:bg-gray-50 transition-colors ${selectedTemplate?.name === tmpl.name && tmplMgrTab === 'list' ? 'bg-blue-50 border-r-2 border-r-blue-400' : ''}`}
                  >
                    <p className="text-sm font-medium text-gray-800 truncate">{tmpl.name.replace(/_/g, ' ')}</p>
                    {varCount > 0 && <span className="text-xs text-orange-400">{varCount} משתנים</span>}
                    {body && <p className="text-xs text-gray-400 truncate mt-0.5">{body.slice(0, 60)}</p>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Template preview / create form */}
          <div className="flex-1 bg-white overflow-y-auto p-6">
            {tmplMgrTab === 'create' ? (
              <div className="max-w-lg">
                <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                  <Plus size={20} className="text-blue-500" /> תבנית חדשה
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-600 block mb-1">שם תבנית <span className="text-gray-400 text-xs">(אנגלית + קווים תחתיים)</span></label>
                    <input type="text" value={createForm.name} dir="ltr"
                      onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="example_template_name"
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    {createForm.name && <p className="text-xs text-gray-400 mt-1">→ {createForm.name.toLowerCase().replace(/[^a-z0-9_]/g,'_')}</p>}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600 block mb-1">קטגוריה</label>
                    <select value={createForm.category}
                      onChange={e => setCreateForm(f => ({ ...f, category: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                      <option value="MARKETING">MARKETING — שיווקי</option>
                      <option value="UTILITY">UTILITY — שירותי / עסקי</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600 block mb-1">כותרת עליונה <span className="text-gray-400 text-xs">(אופציונלי)</span></label>
                    <input type="text" value={createForm.headerText}
                      onChange={e => setCreateForm(f => ({ ...f, headerText: e.target.value }))}
                      placeholder="דרך ההייטק"
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-sm font-medium text-gray-600">גוף ההודעה *</label>
                      <div className="flex gap-1">
                        {[1,2,3].map(n => (
                          <button key={n} onClick={() => setCreateForm(f => ({...f, bodyText: f.bodyText + `{{${n}}}`}))}
                            className="text-xs bg-orange-50 text-orange-600 border border-orange-200 rounded px-2 py-1 hover:bg-orange-100">
                            +{`{{${n}}}`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea value={createForm.bodyText}
                      onChange={e => setCreateForm(f => ({ ...f, bodyText: e.target.value }))}
                      placeholder={`היי {{1}},\n\nכאן {{2}} מדרך ההייטק...\n\nהודעתך כאן.`}
                      rows={6}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
                    <p className="text-xs text-gray-400 mt-1">השתמש ב-{'{{1}}'}, {'{{2}}'} עבור ערכים דינמיים</p>
                  </div>

                  {/* Example values — required by Meta when using variables */}
                  {getVarCount(createForm.bodyText) > 0 && (
                    <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
                      <p className="text-sm font-medium text-orange-700 mb-1">⚠️ ערכי דוגמה — חובה ל-Meta</p>
                      <p className="text-xs text-orange-600 mb-3">מלא ערך לדוגמה לכל משתנה כדי שMeta תאשר את התבנית</p>
                      {Array.from({ length: getVarCount(createForm.bodyText) }, (_, i) => (
                        <div key={i} className="mb-2">
                          <label className="text-xs text-orange-600 block mb-1">{'{{' + (i + 1) + '}}'} — ערך לדוגמה</label>
                          <input
                            type="text"
                            value={exampleValues[i] || ''}
                            onChange={e => {
                              const newEx = [...exampleValues];
                              newEx[i] = e.target.value;
                              setExampleValues(newEx);
                            }}
                            placeholder={`לדוגמה: ${i === 0 ? 'יוסי' : i === 1 ? 'רחל' : 'ערך'}`}
                            className="w-full border border-orange-200 bg-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium text-gray-600 block mb-1">כותרת תחתונה <span className="text-gray-400 text-xs">(אופציונלי)</span></label>
                    <input type="text" value={createForm.footerText} dir="ltr"
                      onChange={e => setCreateForm(f => ({ ...f, footerText: e.target.value }))}
                      placeholder="www.hai.tech"
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </div>
                  {createResult && (
                    <div className={`flex items-start gap-2 p-4 rounded-xl text-sm ${createResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                      {createResult.success ? <CheckCircle size={18} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />}
                      <span>{createResult.message}</span>
                    </div>
                  )}
                  <button onClick={submitCreateTemplate}
                    disabled={creating || !createForm.name.trim() || !createForm.bodyText.trim()}
                    className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 text-white rounded-xl py-3 font-medium flex items-center justify-center gap-2 transition-colors">
                    {creating ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                    {creating ? 'שולח לאישור...' : 'שלח לאישור Meta'}
                  </button>
                  <p className="text-xs text-gray-400 text-center">⏳ Meta מאשרת תבניות תוך כמה שעות עד יום עסקים</p>
                </div>
              </div>
            ) : selectedTemplate && tmplMgrTab === 'list' ? (
              <div className="max-w-lg">
                <h3 className="font-bold text-gray-800 mb-2">{selectedTemplate.name.replace(/_/g, ' ')}</h3>
                <span className="inline-block bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full mb-4">מאושר ✓</span>
                {selectedTemplate.components.map((c, i) => c.text ? (
                  <div key={i} className="mb-4">
                    <p className="text-xs font-medium text-gray-400 mb-1">{c.type}</p>
                    <div className={`rounded-xl p-4 text-sm whitespace-pre-wrap leading-relaxed ${c.type === 'BODY' ? 'bg-green-50 border border-green-100 text-gray-800' : 'bg-gray-50 text-gray-600'}`}>
                      {c.text}
                    </div>
                  </div>
                ) : null)}
                <button onClick={() => { loadTemplates(true); }}
                  className="mt-4 flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-700">
                  <RefreshCw size={14} /> רענן רשימה
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 h-full">
                <FileText size={40} className="mb-3 text-gray-300" />
                <p className="font-medium">בחר תבנית לתצוגה מקדימה</p>
                <p className="text-sm mt-1">או צור תבנית חדשה</p>
                <button onClick={() => setTmplMgrTab('create')}
                  className="mt-4 flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-600">
                  <Plus size={16} /> תבנית חדשה
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Inbox View ── */}
      <div className={`flex flex-1 overflow-hidden ${viewMode !== 'inbox' ? 'hidden' : ''}`} dir="rtl">

      {/* ── New Conversation — Customer Search Modal ── */}
      {showNewConv && !newConvTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col" style={{ maxHeight: '70vh' }}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <PenSquare size={18} className="text-green-500" />
                שיחה חדשה
              </h3>
              <button onClick={() => setShowNewConv(false)} className="p-1.5 hover:bg-gray-100 rounded-full">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            {activePhones.length > 1 && (
              <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
                <span className="text-xs text-gray-500 whitespace-nowrap">שלח מ-</span>
                <select
                  value={selectedFromPhone}
                  onChange={e => setSelectedFromPhone(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-300"
                  dir="ltr"
                >
                  {activePhones.map(p => (
                    <option key={p.phoneNumberId} value={p.phoneNumberId}>{p.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="p-3 border-b border-gray-100">
              <div className="relative">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  type="text"
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  placeholder="חפש לפי שם, טלפון או אימייל..."
                  className="w-full border border-gray-200 rounded-xl pr-9 pl-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {searchingCustomers && (
                <div className="flex items-center justify-center p-6 text-gray-400 gap-2">
                  <RefreshCw size={16} className="animate-spin" /> טוען...
                </div>
              )}
              {!searchingCustomers && customerSearch && customerResults.length === 0 && (
                <div className="text-center text-gray-400 p-6 text-sm">לא נמצאו לקוחות</div>
              )}
              {!customerSearch && (
                <div className="text-center text-gray-400 p-6 text-sm">הקלד שם או מספר טלפון לחיפוש</div>
              )}
              {customerResults.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setNewConvTarget({ phone: c.phone, name: c.name });
                    setShowNewConv(false);
                  }}
                  className="w-full text-right px-4 py-3 border-b border-gray-100 hover:bg-green-50 transition-colors flex items-center gap-3"
                >
                  <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-green-700">{c.name?.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 text-sm">{c.name}</p>
                    <p className="text-xs text-gray-500 dir-ltr">{c.phone}</p>
                  </div>
                  <MessageCircle size={16} className="text-green-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* WaSendModal for new conversation */}
      {newConvTarget && (
        <WaSendModal
          phone={newConvTarget.phone}
          contactName={newConvTarget.name}
          fromPhoneNumberId={selectedFromPhone || undefined}
          onClose={() => setNewConvTarget(null)}
          onSent={() => { setNewConvTarget(null); loadConversations(); }}
        />
      )}

      {/* ── Conversations List ── */}
      <div className="w-80 bg-white border-l border-gray-200 flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle size={20} className="text-green-500" />
            <h2 className="font-bold text-gray-800">WhatsApp Inbox</h2>
            {totalUnread > 0 && (
              <span className="bg-green-500 text-white text-xs rounded-full px-2 py-0.5">
                {totalUnread}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setShowNewConv(true); setCustomerSearch(''); setCustomerResults([]); }}
              className="p-1.5 hover:bg-green-50 rounded-full text-green-600"
              title="שיחה חדשה"
            >
              <PenSquare size={16} />
            </button>
            <button onClick={loadConversations} className="p-1.5 hover:bg-gray-100 rounded-full">
              <RefreshCw size={16} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-gray-400">טוען...</div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
              <MessageCircle size={32} />
              <p className="text-sm">אין שיחות עדיין</p>
            </div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => selectConversation(conv)}
                className={`w-full text-right px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  selected?.id === conv.id ? 'bg-green-50 border-r-2 border-r-green-500' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm text-gray-800 truncate">
                        {conv.contactName || conv.leadName || formatPhone(conv.phone)}
                      </span>
                      {conv.aiEnabled && (
                        <Bot size={12} className="text-purple-400 flex-shrink-0" />
                      )}
                    </div>
                    {conv.businessPhone && (
                      <p className="text-xs text-green-600 font-mono mt-0.5">
                        → {formatPhone(conv.businessPhone.replace('+', ''))}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {conv.lastMessagePreview || 'שיחה חדשה'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {conv.lastMessageAt && (
                      <span className="text-xs text-gray-400">{formatTime(conv.lastMessageAt)}</span>
                    )}
                    {conv.unreadCount > 0 && (
                      <span className="bg-green-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Chat Area ── */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat Header */}
          <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <User size={20} className="text-green-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-800">
                  {selected.contactName || selected.leadName || formatPhone(selected.phone)}
                </p>
                <p className="text-xs text-gray-500">
                  {selected.phone}
                  {selected.businessPhone && (
                    <span className="mr-2 text-green-600">→ {formatPhone(selected.businessPhone.replace('+', ''))}</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* AI toggle */}
              <button
                onClick={() => toggleAI(selected)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  selected.aiEnabled
                    ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                <Bot size={14} />
                {selected.aiEnabled ? 'AI פעיל' : 'AI כבוי'}
              </button>
              {/* Close/reopen */}
              <button
                onClick={() => closeConversation(selected)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  selected.status === 'closed'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {selected.status === 'closed' ? 'פתח מחדש' : <><X size={12} /> סגור שיחה</>}
              </button>
            </div>
          </div>

          {/* Lead info strip */}
          {(selected.leadName || selected.childName || selected.summary) && (
            <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-xs text-yellow-800 flex flex-wrap gap-3">
              {selected.leadName && <span>👤 {selected.leadName}</span>}
              {selected.leadEmail && <span>✉️ {selected.leadEmail}</span>}
              {selected.childName && <span>👦 {selected.childName}{selected.childAge ? `, גיל ${selected.childAge}` : ''}</span>}
              {selected.summary && <span className="text-yellow-700">💬 {selected.summary}</span>}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 text-sm mt-8">טוען הודעות...</div>
            )}
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.direction === 'outbound' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[70%] px-3 py-2 rounded-2xl text-sm shadow-sm ${
                    msg.direction === 'outbound'
                      ? msg.isAiGenerated
                        ? 'bg-purple-100 text-purple-900 rounded-br-sm'
                        : 'bg-green-500 text-white rounded-br-sm'
                      : 'bg-white text-gray-800 rounded-bl-sm border border-gray-100'
                  }`}
                >
                  {msg.isAiGenerated && (
                    <div className="flex items-center gap-1 mb-1 text-purple-500 text-xs">
                      <Bot size={10} /> AI
                    </div>
                  )}
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  <div className={`flex items-center justify-end gap-1 mt-1 ${
                    msg.direction === 'outbound' && !msg.isAiGenerated ? 'text-green-100' : 'text-gray-400'
                  }`}>
                    <span className="text-xs">{formatTime(msg.createdAt)}</span>
                    {msg.direction === 'outbound' && <StatusIcon status={msg.status} />}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="bg-white border-t border-gray-200 p-3">
            {selected.aiEnabled && (
              <p className="text-xs text-purple-500 mb-2 flex items-center gap-1">
                <Bot size={12} /> AI מגיב אוטומטית — שלח הודעה ידנית לדרוס
              </p>
            )}
            <div className="flex items-end gap-2">
              {/* Template picker button */}
              <button
                onClick={() => loadTemplates()}
                disabled={loadingTemplates}
                title="שלח תבנית"
                className="w-10 h-10 bg-blue-50 hover:bg-blue-100 text-blue-500 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
              >
                {loadingTemplates ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={18} />}
              </button>
              {/* Payment link button */}
              <button
                onClick={() => setShowPayModal(true)}
                title="שלח לינק תשלום"
                className="w-10 h-10 bg-purple-50 hover:bg-purple-100 text-purple-500 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
              >
                <CreditCard size={18} />
              </button>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                }}
                placeholder="כתוב הודעה..."
                rows={1}
                className="flex-1 resize-none border border-gray-300 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300 max-h-32"
                style={{ minHeight: '44px' }}
                disabled={sending}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || sending}
                className="w-10 h-10 bg-green-500 hover:bg-green-600 disabled:bg-gray-200 text-white rounded-full flex items-center justify-center transition-colors flex-shrink-0"
              >
                <Send size={18} />
              </button>
            </div>
          </div>

          {/* Template Modal */}
          {showTemplateModal && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <FileText size={20} className="text-blue-500" />
                    <h3 className="font-bold text-gray-800">שליחת תבנית WhatsApp</h3>
                    <span className="text-xs text-gray-400">({templates.length} תבניות)</span>
                  </div>
                  <button onClick={() => { setShowTemplateModal(false); setSelectedTemplate(null); setTemplateVars([]); setShowCreateTemplate(false); setCreateResult(null); }}
                    className="p-1.5 hover:bg-gray-100 rounded-full">
                    <X size={18} className="text-gray-500" />
                  </button>
                </div>

                <div className="flex flex-1 overflow-hidden">
                  {/* Template list */}
                  <div className="w-1/2 border-l border-gray-100 flex flex-col overflow-hidden">
                    {/* Create new button */}
                    <button
                      onClick={() => { setShowCreateTemplate(true); setSelectedTemplate(null); setCreateResult(null); }}
                      className={`flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 text-sm font-medium transition-colors flex-shrink-0 ${showCreateTemplate ? 'bg-blue-50 text-blue-600' : 'text-blue-500 hover:bg-blue-50'}`}
                    >
                      <Plus size={15} />
                      תבנית חדשה
                    </button>
                    <div className="flex-1 overflow-y-auto">
                      <div className="px-3 py-2 border-b border-gray-100">
                        <input
                          type="text"
                          value={templateSearch}
                          onChange={e => setTemplateSearch(e.target.value)}
                          placeholder="חיפוש תבנית..."
                          dir="rtl"
                          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        />
                      </div>
                      <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                        <p className="text-xs text-gray-400 font-medium">תבניות מאושרות ({templates.filter(t => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())).length})</p>
                      </div>
                    {templates.filter(t => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())).map(tmpl => {
                      const body = getBodyText(tmpl);
                      const varCount = countVars(body);
                      const isSelected = !showCreateTemplate && selectedTemplate?.name === tmpl.name;
                      const isExpanded = expandedTemplate === tmpl.name;
                      return (
                        <div key={tmpl.name}
                          className={`border-b border-gray-100 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 border-r-2 border-r-blue-400' : 'hover:bg-gray-50'}`}
                          onClick={() => { selectTemplate(tmpl); setShowCreateTemplate(false); }}
                        >
                          <div className="px-3 py-2.5 flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{tmpl.name.replace(/_/g, ' ')}</p>
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
                              <p className="text-xs text-gray-500 whitespace-pre-wrap bg-gray-50 rounded p-2 leading-relaxed">{body.slice(0, 200)}{body.length > 200 ? '...' : ''}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  </div>

                  {/* Right panel — variables + preview OR create form */}
                  <div className="w-1/2 flex flex-col overflow-y-auto">
                    {showCreateTemplate ? (
                      <div className="flex flex-col p-4 gap-3 h-full">
                        <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                          <Plus size={16} className="text-blue-500" /> תבנית חדשה
                        </h4>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">שם תבנית (אנגלית, קווים תחתיים)</label>
                          <input type="text" value={createForm.name} dir="ltr"
                            onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="first_message"
                            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                          {createForm.name && <p className="text-xs text-gray-400 mt-0.5">→ {createForm.name.toLowerCase().replace(/[^a-z0-9_]/g,'_')}</p>}
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">קטגוריה</label>
                          <select value={createForm.category}
                            onChange={e => setCreateForm(f => ({ ...f, category: e.target.value }))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                            <option value="MARKETING">MARKETING — שיווקי</option>
                            <option value="UTILITY">UTILITY — שירותי</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">כותרת עליונה <span className="text-gray-300">(אופציונלי)</span></label>
                          <input type="text" value={createForm.headerText}
                            onChange={e => setCreateForm(f => ({ ...f, headerText: e.target.value }))}
                            placeholder="דרך ההייטק"
                            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs text-gray-500">גוף ההודעה *</label>
                            <div className="flex gap-1">
                              {[1,2,3].map(n => (
                                <button key={n} onClick={() => setCreateForm(f => ({...f, bodyText: f.bodyText + `{{${n}}}`}))}
                                  className="text-xs bg-orange-50 text-orange-600 border border-orange-200 rounded px-1.5 py-0.5 hover:bg-orange-100">
                                  +{`{{${n}}}`}
                                </button>
                              ))}
                            </div>
                          </div>
                          <textarea value={createForm.bodyText}
                            onChange={e => setCreateForm(f => ({ ...f, bodyText: e.target.value }))}
                            placeholder={`היי {{1}},\nתוכן ההודעה...`}
                            rows={4}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">כותרת תחתונה <span className="text-gray-300">(אופציונלי)</span></label>
                          <input type="text" value={createForm.footerText} dir="ltr"
                            onChange={e => setCreateForm(f => ({ ...f, footerText: e.target.value }))}
                            placeholder="www.hai.tech"
                            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                        </div>
                        {createResult && (
                          <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${createResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                            {createResult.success ? <CheckCircle size={16} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />}
                            <span>{createResult.message}</span>
                          </div>
                        )}
                        <button onClick={submitCreateTemplate} disabled={creating || !createForm.name.trim() || !createForm.bodyText.trim()}
                          className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 text-white rounded-xl py-2.5 font-medium flex items-center justify-center gap-2 transition-colors">
                          {creating ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                          {creating ? 'יוצר...' : 'שלח לאישור Meta'}
                        </button>
                        <p className="text-xs text-gray-400 text-center">⏳ אישור Meta לוקח עד 24 שעות</p>
                      </div>
                    ) : selectedTemplate ? (
                      <div className="flex flex-col p-4">
                        <h4 className="font-semibold text-gray-700 mb-3">{selectedTemplate.name.replace(/_/g, ' ')}</h4>

                        {/* Variables */}
                        {templateVars.length > 0 && (
                          <div className="mb-4">
                            <p className="text-xs font-medium text-gray-500 mb-2">מלא את המשתנים:</p>
                            {templateVars.map((v, i) => (
                              <div key={i} className="mb-2">
                                <label className="text-xs text-gray-500 block mb-1">{'{{' + (i + 1) + '}}'}</label>
                                <input
                                  type="text"
                                  value={v}
                                  onChange={e => {
                                    const newVars = [...templateVars];
                                    newVars[i] = e.target.value;
                                    setTemplateVars(newVars);
                                  }}
                                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                  placeholder={`ערך ${i + 1}`}
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Preview */}
                        <div className="flex-1">
                          <p className="text-xs font-medium text-gray-500 mb-2">תצוגה מקדימה:</p>
                          <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                            {renderPreview() || <span className="text-gray-400">בחר תבנית...</span>}
                          </div>
                        </div>

                        <button
                          onClick={sendTemplate}
                          disabled={sending}
                          className="mt-4 w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-200 text-white rounded-xl py-2.5 font-medium flex items-center justify-center gap-2 transition-colors"
                        >
                          <Send size={16} />
                          שלח תבנית
                        </button>
                      </div>
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
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <MessageCircle size={48} className="mb-3 text-gray-300" />
          <p className="text-lg font-medium">בחר שיחה</p>
          <p className="text-sm">בחר שיחה מהרשימה כדי להתחיל</p>
        </div>
      )}
    </div>
    {/* close inbox view wrapper */}

    {/* Payment link modal */}
    {showPayModal && selected && (
      <WooPayModal
        onClose={() => setShowPayModal(false)}
        customerName={selected.contactName || selected.leadName || ''}
        customerPhone={selected.phone}
        waConversationId={selected.id}
        waPhoneNumberId={selected.phoneNumberId || undefined}
      />
    )}
    </div>
  );
}
