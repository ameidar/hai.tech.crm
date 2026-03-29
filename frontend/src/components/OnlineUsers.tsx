import { useState, useEffect } from 'react';

interface OnlineUser {
  id: string;
  name: string;
  email: string;
  role: string;
  lastActive: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'מנהל מערכת',
  manager: 'מנהל',
  instructor: 'מדריך',
  sales: 'מכירות',
};

const ROLE_COLOR: Record<string, string> = {
  admin: '#7c3aed',
  manager: '#1a56db',
  instructor: '#059669',
  sales: '#d97706',
};

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'עכשיו';
  if (diff < 120) return 'לפני דקה';
  return `לפני ${Math.floor(diff / 60)} דקות`;
}

export default function OnlineUsers() {
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchOnline = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken') || '';
      const res = await fetch('/api/system-users/online', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.onlineUsers || []);
      }
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchOnline();
    const interval = setInterval(fetchOnline, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      {/* Badge button */}
      <button
        onClick={() => { setOpen(o => !o); if (!open) fetchOnline(); }}
        title="משתמשים מחוברים"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: '1px solid #e5e7eb',
          borderRadius: 20,
          padding: '5px 10px',
          cursor: 'pointer',
          color: '#374151',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: users.length > 0 ? '#10b981' : '#9ca3af',
          display: 'inline-block',
          boxShadow: users.length > 0 ? '0 0 0 2px rgba(16,185,129,0.3)' : 'none',
        }} />
        {loading ? '...' : users.length}
        <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400 }}>מחוברים</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          top: '110%',
          left: 0,
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          minWidth: 240,
          zIndex: 9999,
          overflow: 'hidden',
          direction: 'rtl',
        }}>
          <div style={{
            padding: '10px 14px',
            borderBottom: '1px solid #f3f4f6',
            fontSize: 12,
            fontWeight: 700,
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            🟢 מחוברים עכשיו
          </div>

          {users.length === 0 ? (
            <div style={{ padding: '16px 14px', color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
              אין משתמשים מחוברים כרגע
            </div>
          ) : (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {users.map(u => (
                <div key={u.id} style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  borderBottom: '1px solid #f9fafb',
                }}>
                  {/* Avatar */}
                  <div style={{
                    width: 34, height: 34, borderRadius: '50%',
                    background: ROLE_COLOR[u.role] || '#6b7280',
                    color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, flexShrink: 0,
                  }}>
                    {u.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>
                      {ROLE_LABELS[u.role] || u.role} · {timeAgo(u.lastActive)}
                    </div>
                  </div>
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: '#10b981', flexShrink: 0,
                  }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Backdrop to close */}
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
          onClick={() => setOpen(false)}
        />
      )}
    </div>
  );
}
