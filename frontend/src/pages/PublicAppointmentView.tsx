import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface AppointmentData {
  customerName: string;
  childName?: string | null;
  interest?: string | null;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
  status: string;
  cancelledAt?: string | null;
  canCancel: boolean;
}

const statusLabels: Record<string, string> = {
  pending: 'ממתינה לתיאום',
  queued: 'ממתינה לתיאום',
  scheduled: 'מאושרת',
  completed: 'התקיימה',
  cancelled: 'בוטלה',
  no_answer: 'ממתינה לתיאום',
};

export default function PublicAppointmentView() {
  const { id, token } = useParams<{ id: string; token: string }>();
  const [data, setData] = useState<AppointmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    if (!id || !token) return;
    axios
      .get(`${API_BASE}/public/appointment/${id}/${token}`)
      .then((res) => {
        setData(res.data);
        setLoading(false);
      })
      .catch(() => {
        setError('הפגישה לא נמצאה או שהקישור אינו תקין');
        setLoading(false);
      });
  }, [id, token]);

  const handleCancel = async () => {
    setSubmitting(true);
    try {
      await axios.post(`${API_BASE}/public/appointment/${id}/${token}/cancel`, { reason });
      setCancelled(true);
    } catch (err: any) {
      alert(err.response?.data?.error || 'שגיאה בביטול הפגישה');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.spinner} />
          <p style={{ textAlign: 'center', color: '#6b7280' }}>טוען...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
            <h2 style={{ color: '#dc2626' }}>{error || 'שגיאה'}</h2>
          </div>
        </div>
      </div>
    );
  }

  if (cancelled) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2 style={{ color: '#1f2937', marginBottom: 12 }}>הפגישה בוטלה</h2>
            <p style={{ color: '#6b7280', lineHeight: 1.6 }}>
              הפגישה בוטלה בהצלחה.<br />
              נשמח לראותך בהזדמנות אחרת — אפשר תמיד לקבוע פגישה חדשה.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isCancelled = data.status === 'cancelled';
  const dateStr = data.appointmentDate
    ? new Date(data.appointmentDate).toLocaleDateString('he-IL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Jerusalem',
      })
    : null;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <h1 style={{ color: '#fff', margin: 0, fontSize: 24 }}>🎯 Hai.Tech</h1>
          <p style={{ color: 'rgba(255,255,255,0.9)', margin: '8px 0 0', fontSize: 14 }}>
            פרטי הפגישה שלך
          </p>
        </div>

        <div style={{ padding: '30px 24px' }}>
          {/* Status badge */}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <span
              style={{
                display: 'inline-block',
                padding: '6px 16px',
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 600,
                backgroundColor: isCancelled ? '#fee2e2' : data.status === 'scheduled' ? '#dcfce7' : '#fef3c7',
                color: isCancelled ? '#b91c1c' : data.status === 'scheduled' ? '#166534' : '#92400e',
              }}
            >
              {isCancelled ? '❌ הפגישה בוטלה' : `פגישת היכרות — ${statusLabels[data.status] || data.status}`}
            </span>
          </div>

          {/* Details */}
          <div style={styles.infoBox}>
            <InfoRow label="שם" value={data.customerName} />
            {data.childName && <InfoRow label="ילד/ה" value={data.childName} />}
            {data.interest && <InfoRow label="נושא" value={data.interest} />}
            {dateStr && <InfoRow label="📅 תאריך" value={dateStr} />}
            {data.appointmentTime && <InfoRow label="🕐 שעה" value={data.appointmentTime} />}
            {!dateStr && !isCancelled && (
              <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
                מועד הפגישה טרם נקבע — ניצור איתך קשר לתיאום.
              </p>
            )}
          </div>

          {/* Cancel section */}
          {data.canCancel && !showCancelForm && (
            <button onClick={() => setShowCancelForm(true)} style={styles.cancelLinkBtn}>
              ברצוני לבטל את הפגישה
            </button>
          )}

          {data.canCancel && showCancelForm && (
            <div style={{ marginTop: 8 }}>
              <div style={styles.warnBox}>
                <p style={{ margin: 0, fontSize: 14, color: '#92400e' }}>
                  בטוחים שברצונכם לבטל? אם המועד לא מתאים, אפשר גם ליצור איתנו קשר ולתאם מועד אחר.
                </p>
              </div>
              <label style={styles.label}>סיבת הביטול (לא חובה)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="נשמח לדעת למה..."
                style={styles.textarea}
                rows={3}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button
                  onClick={handleCancel}
                  disabled={submitting}
                  style={{
                    ...styles.confirmCancelBtn,
                    opacity: submitting ? 0.6 : 1,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? 'מבטל...' : 'כן, בטל את הפגישה'}
                </button>
                <button onClick={() => setShowCancelForm(false)} style={styles.keepBtn}>
                  השאר את הפגישה
                </button>
              </div>
            </div>
          )}

          {!data.canCancel && !isCancelled && data.status === 'completed' && (
            <p style={{ textAlign: 'center', fontSize: 14, color: '#6b7280' }}>
              הפגישה כבר התקיימה. תודה שהגעתם! 🙏
            </p>
          )}

          <p style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 24 }}>
            יש שאלה? צרו קשר — info@hai.tech
          </p>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <p style={{ margin: '0 0 8px', fontSize: 15, color: '#1f2937' }}>
      <span style={{ fontWeight: 600 }}>{label}: </span>
      {value}
    </p>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    direction: 'rtl',
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
  },
  card: {
    maxWidth: 500,
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  },
  header: {
    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
    padding: '30px 24px',
    textAlign: 'center' as const,
  },
  infoBox: {
    backgroundColor: '#f0f9ff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  warnBox: {
    backgroundColor: '#fffbeb',
    border: '1px solid #fbbf24',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  label: {
    display: 'block',
    marginBottom: 6,
    fontWeight: 600,
    fontSize: 14,
    color: '#374151',
  },
  textarea: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
    direction: 'rtl' as const,
  },
  cancelLinkBtn: {
    width: '100%',
    padding: '12px 24px',
    backgroundColor: '#fff',
    color: '#dc2626',
    border: '1px solid #fca5a5',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  confirmCancelBtn: {
    flex: 1,
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    fontFamily: 'inherit',
  },
  keepBtn: {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '4px solid #e5e7eb',
    borderTop: '4px solid #2563eb',
    borderRadius: '50%',
    margin: '0 auto 16px',
    animation: 'spin 1s linear infinite',
  },
};
