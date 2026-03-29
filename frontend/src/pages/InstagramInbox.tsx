/**
 * Instagram DM Inbox
 * HaiTech CRM — דרך ההייטק
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Bot, BotOff, RefreshCw, User } from 'lucide-react';

const API = '/api/instagram';

interface Conversation {
  id: string;
  igsid: string;
  sender_name: string;
  sender_username: string;
  ig_user_id: string;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  ai_enabled: boolean;
  created_at: string;
}

interface Message {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  msg_id: string | null;
  is_ai_generated: boolean;
  created_at: string;
}

function formatTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

function getHeaders() {
  const token = localStorage.getItem('accessToken');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Instagram gradient icon
function InstagramIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f09433" />
          <stop offset="25%" stopColor="#e6683c" />
          <stop offset="50%" stopColor="#dc2743" />
          <stop offset="75%" stopColor="#cc2366" />
          <stop offset="100%" stopColor="#bc1888" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5" stroke="url(#ig-grad)" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" stroke="url(#ig-grad)" strokeWidth="2" />
      <circle cx="17.5" cy="6.5" r="1" fill="url(#ig-grad)" />
    </svg>
  );
}

export default function InstagramInbox() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch(`${API}/conversations`, { headers: getHeaders() });
      const data = await res.json();
      setConversations(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchMessages = useCallback(async (convId: string) => {
    const res = await fetch(`${API}/conversations/${convId}/messages`, { headers: getHeaders() });
    const data = await res.json();
    setMessages(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // Poll for new conversations every 15s
  useEffect(() => {
    const interval = setInterval(() => fetchConversations(true), 15000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const selectConversation = async (conv: Conversation) => {
    setSelectedConv(conv);
    await fetchMessages(conv.id);
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unread_count: 0 } : c));
  };

  const handleSend = async () => {
    if (!replyText.trim() || !selectedConv) return;
    setSending(true);
    try {
      const res = await fetch(`${API}/send`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          conversation_id: selectedConv.id,
          igsid: selectedConv.igsid,
          text: replyText,
        }),
      });
      const msg = await res.json();
      if (msg && !msg.error) {
        setMessages(prev => [...prev, msg]);
        setConversations(prev => prev.map(c =>
          c.id === selectedConv.id ? { ...c, last_message: replyText, last_message_at: new Date().toISOString() } : c
        ));
        setReplyText('');
      } else {
        alert(msg.error || 'שגיאה בשליחה');
      }
    } finally {
      setSending(false);
    }
  };

  const toggleAI = async (convId: string, current: boolean) => {
    const newVal = !current;
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, ai_enabled: newVal } : c));
    if (selectedConv?.id === convId) setSelectedConv(prev => prev ? { ...prev, ai_enabled: newVal } : prev);
    await fetch(`${API}/conversations/${convId}/ai`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ aiEnabled: newVal }),
    });
  };

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-50 overflow-hidden" dir="rtl">
      {/* Sidebar */}
      <div className="w-80 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <InstagramIcon className="w-5 h-5" />
            <h2 className="font-semibold text-gray-800">Instagram DMs</h2>
            <span className="text-xs text-gray-400">({conversations.length})</span>
          </div>
          <button
            onClick={() => fetchConversations(true)}
            className={`p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors ${refreshing ? 'animate-spin' : ''}`}
            title="רענן"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Conversations */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 text-sm">טוען שיחות...</div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
              <InstagramIcon className="w-8 h-8 opacity-40" />
              <span className="text-sm">אין שיחות עדיין</span>
              <span className="text-xs">שלח DM ל-@hai.tech_way</span>
            </div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => selectConversation(conv)}
                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedConv?.id === conv.id ? 'bg-pink-50 border-r-2 border-r-pink-500' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 via-pink-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium text-gray-800 text-sm truncate">{conv.sender_name}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">{formatTime(conv.last_message_at)}</span>
                    </div>
                    {conv.sender_username && (
                      <p className="text-xs text-pink-500">@{conv.sender_username}</p>
                    )}
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                      <p className="text-xs text-gray-500 truncate">{conv.last_message || 'שיחה חדשה'}</p>
                      {conv.unread_count > 0 && (
                        <span className="bg-pink-500 text-white text-xs rounded-full px-1.5 py-0.5 flex-shrink-0">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                    {conv.ai_enabled && (
                      <span className="text-xs text-purple-500 flex items-center gap-1 mt-0.5">
                        <Bot className="w-3 h-3" /> AI פעיל
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main — messages */}
      {selectedConv ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat header */}
          <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 via-pink-500 to-purple-600 flex items-center justify-center">
                <User className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-medium text-gray-800">{selectedConv.sender_name}</p>
                <p className="text-xs text-pink-500">
                  {selectedConv.sender_username ? `@${selectedConv.sender_username}` : selectedConv.igsid}
                </p>
              </div>
            </div>
            <button
              onClick={() => toggleAI(selectedConv.id, selectedConv.ai_enabled)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedConv.ai_enabled
                  ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {selectedConv.ai_enabled ? <Bot className="w-3.5 h-3.5" /> : <BotOff className="w-3.5 h-3.5" />}
              {selectedConv.ai_enabled ? 'AI פעיל' : 'AI כבוי'}
            </button>
          </div>

          {/* Messages */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.direction === 'outbound' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
                    msg.direction === 'outbound'
                      ? msg.is_ai_generated
                        ? 'bg-purple-100 text-purple-900'
                        : 'bg-gradient-to-br from-orange-400 via-pink-500 to-purple-600 text-white'
                      : 'bg-white text-gray-800 border border-gray-200'
                  }`}
                >
                  {msg.is_ai_generated && (
                    <div className="flex items-center gap-1 text-xs text-purple-600 mb-1">
                      <Bot className="w-3 h-3" /> AI
                    </div>
                  )}
                  <p style={{ direction: 'rtl', unicodeBidi: 'plaintext' }}>{msg.content}</p>
                  <p className={`text-xs mt-1 opacity-60 ${msg.direction === 'outbound' && !msg.is_ai_generated ? 'text-white' : 'text-gray-400'}`}>
                    {formatTime(msg.created_at)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply input */}
          <div className="bg-white border-t border-gray-200 p-4">
            <div className="flex items-end gap-2">
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="כתוב תגובה... (Enter לשליחה)"
                rows={2}
                className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                dir="rtl"
              />
              <button
                onClick={handleSend}
                disabled={sending || !replyText.trim()}
                className="bg-gradient-to-br from-orange-400 via-pink-500 to-purple-600 hover:opacity-90 disabled:opacity-40 text-white p-2.5 rounded-xl transition-opacity"
                title="שלח"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-3">
          <InstagramIcon className="w-12 h-12 opacity-30" />
          <p className="text-sm">בחר שיחה מהרשימה</p>
          <p className="text-xs opacity-60">@hai.tech_way</p>
        </div>
      )}
    </div>
  );
}
