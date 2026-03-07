import { useState, useEffect } from 'react';
import { Linkedin, CheckCircle, XCircle, Send, RefreshCw, ExternalLink, Trash2, AlertCircle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getToken() {
  return localStorage.getItem('accessToken') || '';
}

export default function LinkedIn() {
  const [status, setStatus] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [postText, setPostText] = useState('');
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<{ success?: boolean; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [charCount, setCharCount] = useState(0);

  const MAX_CHARS = 3000;

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/linkedin/status`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setStatus(data);
    } catch {}
    setLoading(false);
  };

  const fetchPosts = async () => {
    try {
      const res = await fetch(`${API_BASE}/linkedin/posts`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setPosts(data.posts || []);
    } catch {}
  };

  useEffect(() => {
    // Check URL params for connect result
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === '1') {
      window.history.replaceState({}, '', '/linkedin');
    }
    fetchStatus();
    fetchPosts();
  }, []);

  const handleConnect = () => {
    window.location.href = `${API_BASE}/linkedin/auth`;
  };

  const handleDisconnect = async () => {
    if (!confirm('לנתק את חשבון LinkedIn?')) return;
    await fetch(`${API_BASE}/linkedin/disconnect`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    setStatus({ connected: false });
    setPosts([]);
  };

  const handlePost = async () => {
    if (!postText.trim()) return;
    setPosting(true);
    setPostResult(null);
    try {
      const res = await fetch(`${API_BASE}/linkedin/post`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: postText }),
      });
      const data = await res.json();
      if (data.success) {
        setPostResult({ success: true });
        setPostText('');
        setCharCount(0);
        fetchPosts();
      } else {
        setPostResult({ error: data.error || 'שגיאה בפרסום' });
      }
    } catch (e: any) {
      setPostResult({ error: e.message });
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loading loading-spinner loading-lg text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#0077b5] rounded-lg flex items-center justify-center">
            <Linkedin size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">LinkedIn</h1>
            <p className="text-gray-500 text-sm">פרסום פוסטים ואנליטיקות</p>
          </div>
        </div>
        <button onClick={fetchStatus} className="btn btn-outline btn-sm">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Connection status */}
      <div className={`card border p-5 mb-6 ${status?.connected ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status?.connected ? (
              <CheckCircle size={24} className="text-green-500" />
            ) : (
              <XCircle size={24} className="text-gray-400" />
            )}
            <div>
              <p className="font-semibold">
                {status?.connected ? `מחובר — ${status.name}` : 'לא מחובר'}
              </p>
              {status?.connected && (
                <p className="text-sm text-gray-500">
                  {status.email} · תפוגה: {new Date(status.expiresAt).toLocaleDateString('he-IL')}
                </p>
              )}
              {status?.expired && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle size={14} /> Token פג — יש להתחבר מחדש
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {status?.connected ? (
              <>
                <a
                  href="https://www.linkedin.com/company/hai-tech-way/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline btn-sm flex items-center gap-1"
                >
                  <ExternalLink size={14} /> עמוד LinkedIn
                </a>
                <button onClick={handleDisconnect} className="btn btn-ghost btn-sm text-red-500">
                  <Trash2 size={14} /> נתק
                </button>
              </>
            ) : (
              <button onClick={handleConnect} className="btn btn-sm bg-[#0077b5] text-white hover:bg-[#005e94]">
                <Linkedin size={16} /> התחבר עם LinkedIn
              </button>
            )}
          </div>
        </div>
      </div>

      {status?.connected && (
        <>
          {/* Post composer */}
          <div className="card bg-base-100 shadow-sm border border-base-200 p-5 mb-6">
            <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Send size={18} className="text-[#0077b5]" /> פרסם פוסט חדש
            </h2>
            <textarea
              className="textarea textarea-bordered w-full text-right"
              rows={6}
              placeholder="מה אתה רוצה לשתף עם הרשת שלך? 📝"
              value={postText}
              onChange={(e) => {
                setPostText(e.target.value);
                setCharCount(e.target.value.length);
                setPostResult(null);
              }}
              maxLength={MAX_CHARS}
            />
            <div className="flex items-center justify-between mt-3">
              <span className={`text-sm ${charCount > MAX_CHARS * 0.9 ? 'text-orange-500' : 'text-gray-400'}`}>
                {charCount} / {MAX_CHARS}
              </span>
              <div className="flex items-center gap-3">
                {postResult?.success && (
                  <span className="text-green-600 text-sm flex items-center gap-1">
                    <CheckCircle size={16} /> פורסם בהצלחה!
                  </span>
                )}
                {postResult?.error && (
                  <span className="text-red-500 text-sm">{postResult.error}</span>
                )}
                <button
                  onClick={handlePost}
                  disabled={posting || !postText.trim()}
                  className="btn btn-sm bg-[#0077b5] text-white hover:bg-[#005e94] disabled:opacity-50"
                >
                  {posting ? <span className="loading loading-spinner loading-xs" /> : <Send size={14} />}
                  פרסם
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              * הפוסט מפורסם מהפרופיל האישי שלך. פרסום מעמוד החברה יתאפשר לאחר אישור Marketing Developer Platform מ-LinkedIn.
            </p>
          </div>

          {/* Recent posts */}
          {posts.length > 0 && (
            <div className="card bg-base-100 shadow-sm border border-base-200 p-5">
              <h2 className="font-semibold text-gray-700 mb-4">📋 פוסטים אחרונים</h2>
              <div className="space-y-3">
                {posts.map((p: any, i: number) => (
                  <div key={i} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <p className="text-sm text-gray-700">{p.text}{p.text?.length >= 100 ? '…' : ''}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(p.createdAt).toLocaleString('he-IL')}
                      </p>
                    </div>
                    <span className="badge badge-success badge-sm mr-3">{p.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!status?.connected && (
        <div className="text-center py-12 text-gray-400">
          <Linkedin size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium">לא מחובר ל-LinkedIn</p>
          <p className="text-sm mt-1">לחץ "התחבר עם LinkedIn" כדי להתחיל</p>
        </div>
      )}
    </div>
  );
}
