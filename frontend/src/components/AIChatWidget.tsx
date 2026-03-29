import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
}

const WELCOME: Record<string, string> = {
  admin: 'שלום מנהל! אני יכול לענות על כל שאלה על הנתונים במערכת. נסה: "כמה לידים נפתחו השבוע?" או "מה הרווח החודשי?"',
  manager: 'שלום מנהל! אני יכול לענות על כל שאלה על הנתונים במערכת. נסה: "כמה לידים נפתחו השבוע?" או "מה הרווח החודשי?"',
  instructor: 'שלום! אני יכול לענות על שאלות הקשורות לפעילות שלך. נסה: "כמה שיעורים יש לי החודש?" או "אילו מחזורים אני מלמד?"',
  sales: 'שלום! אני יכול לעזור עם מידע על לידים ולקוחות. נסה: "כמה לידים חדשים יש היום?" או "מי הלקוחות שלא טופלו?"',
};

export default function AIChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const role = (user as any)?.role || 'instructor';

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: WELCOME[role] || WELCOME.instructor
      }]);
    }
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg: Message = { role: 'user', content: text };
    const loadingMsg: Message = { role: 'assistant', content: '', loading: true };
    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setLoading(true);

    try {
      const token = localStorage.getItem('accessToken') || '';
      const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text, history }),
      });

      const data = await res.json();
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: data.answer || data.error || 'לא הצלחתי לקבל תשובה' }
      ]);
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: 'שגיאה בחיבור לשרת. נסה שוב.' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 9999, direction: 'rtl' }}>
      {/* Chat Panel */}
      {open && (
        <div style={{
          width: 360,
          height: 500,
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          marginBottom: 12,
          overflow: 'hidden',
          border: '1px solid #e5e7eb'
        }}>
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #1a56db, #7c3aed)',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#fff'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>🤖</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>AI Assistant</div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>שאלות על נתוני המערכת</div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}
            >×</button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: '#f9fafb'
          }}>
            {messages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-start' : 'flex-end',
              }}>
                <div style={{
                  maxWidth: '80%',
                  padding: '9px 13px',
                  borderRadius: msg.role === 'user'
                    ? '4px 14px 14px 14px'
                    : '14px 4px 14px 14px',
                  background: msg.role === 'user' ? '#1a56db' : '#fff',
                  color: msg.role === 'user' ? '#fff' : '#111',
                  fontSize: 13,
                  lineHeight: 1.6,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  whiteSpace: 'pre-wrap',
                  border: msg.role === 'assistant' ? '1px solid #e5e7eb' : 'none'
                }}>
                  {msg.loading ? (
                    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ animation: 'pulse 1s infinite' }}>●</span>
                      <span style={{ animation: 'pulse 1s infinite 0.2s' }}>●</span>
                      <span style={{ animation: 'pulse 1s infinite 0.4s' }}>●</span>
                    </span>
                  ) : msg.content}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '10px 12px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            gap: 8,
            background: '#fff'
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="שאל שאלה..."
              disabled={loading}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                fontSize: 13,
                outline: 'none',
                direction: 'rtl',
                background: loading ? '#f3f4f6' : '#fff'
              }}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              style={{
                background: loading || !input.trim() ? '#9ca3af' : '#1a56db',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 600,
                transition: 'background 0.2s'
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: open
            ? '#6b7280'
            : 'linear-gradient(135deg, #1a56db, #7c3aed)',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          fontSize: 22,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s',
          marginRight: 'auto'
        }}
        title="AI Assistant"
      >
        {open ? '×' : '🤖'}
      </button>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
