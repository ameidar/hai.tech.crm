import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface CancellationData {
  studentName: string;
  customerName: string;
  courseName: string;
  completedMeetings: number;
  totalMeetings: number;
}

export default function PublicCancelForm() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<CancellationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [reason, setReason] = useState('');
  const [signature, setSignature] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) return;
    axios
      .get(`${API_BASE}/public/cancel/${token}`)
      .then((res) => {
        setData(res.data);
        setLoading(false);
      })
      .catch((err) => {
        if (err.response?.data?.alreadySubmitted) {
          setAlreadySubmitted(true);
        } else {
          setError('טופס ביטול לא נמצא או שפג תוקפו');
        }
        setLoading(false);
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signature.trim()) {
      alert('נא להזין שם מלא כחתימה דיגיטלית');
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(`${API_BASE}/public/cancel/${token}`, { reason, signature });
      setSubmitted(true);
    } catch (err: any) {
      alert(err.response?.data?.error || 'שגיאה בשליחת הטופס');
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

  if (alreadySubmitted || submitted) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2 style={{ color: '#1f2937', marginBottom: 12 }}>בקשת הביטול התקבלה</h2>
            <p style={{ color: '#6b7280', lineHeight: 1.6 }}>
              תודה. בקשת הביטול שלך התקבלה ותטופל בהקדם.<br />
              צוות Hai.Tech יצור איתך קשר במידת הצורך.
            </p>
          </div>
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

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <h1 style={{ color: '#fff', margin: 0, fontSize: 24 }}>🎯 Hai.Tech</h1>
          <p style={{ color: 'rgba(255,255,255,0.9)', margin: '8px 0 0', fontSize: 14 }}>טופס בקשת ביטול</p>
        </div>

        <div style={{ padding: '30px 24px' }}>
          {/* Student info */}
          <div style={styles.infoBox}>
            <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#1f2937' }}>
              {data.studentName}
            </p>
            <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
              קורס: {data.courseName}
            </p>
          </div>

          {/* Retention message */}
          <div style={styles.retentionBox}>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: '#92400e' }}>
              💡 <strong>לפני שמבטלים — שימו לב!</strong><br />
              הילד/ה כבר עבר/ה <strong>{data.completedMeetings}</strong> שיעורים מתוך <strong>{data.totalMeetings}</strong>.
              <br />
              אנחנו כאן כדי לעזור! אם יש בעיה, נשמח לשמוע ולמצוא פתרון.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label style={styles.label}>סיבת הביטול</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="נא לפרט את הסיבה לביטול..."
                style={styles.textarea}
                rows={4}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={styles.label}>חתימה דיגיטלית (שם מלא)</label>
              <input
                type="text"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="הזינו את שמכם המלא כחתימה"
                style={styles.input}
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{
                ...styles.submitBtn,
                opacity: submitting ? 0.6 : 1,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'שולח...' : 'אישור בקשת ביטול'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 20 }}>
            לאחר שליחת הטופס, צוות Hai.Tech יטפל בבקשתך.
          </p>
        </div>
      </div>
    </div>
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
    marginBottom: 16,
  },
  retentionBox: {
    backgroundColor: '#fffbeb',
    border: '1px solid #fbbf24',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
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
  input: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: 14,
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
    direction: 'rtl' as const,
  },
  submitBtn: {
    width: '100%',
    padding: '14px 24px',
    background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    fontFamily: 'inherit',
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
