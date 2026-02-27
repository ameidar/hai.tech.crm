import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, Bot, User, RefreshCw, Check, CheckCheck, Clock, PhoneCall, X } from 'lucide-react';

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
  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [selected, setSelected] = useState<WaConversation | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
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

  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-50 overflow-hidden" dir="rtl">

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
          <button onClick={loadConversations} className="p-1.5 hover:bg-gray-100 rounded-full">
            <RefreshCw size={16} className="text-gray-500" />
          </button>
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
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <MessageCircle size={48} className="mb-3 text-gray-300" />
          <p className="text-lg font-medium">בחר שיחה</p>
          <p className="text-sm">בחר שיחה מהרשימה כדי להתחיל</p>
        </div>
      )}
    </div>
  );
}
