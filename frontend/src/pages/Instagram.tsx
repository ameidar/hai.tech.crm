import { useState, useEffect } from 'react';
import { Instagram, CheckCircle, XCircle, Send, Sparkles, Image, RefreshCw, Copy } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
function getToken() { return localStorage.getItem('accessToken') || ''; }
const headers = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

export default function InstagramPage() {
  const [status, setStatus] = useState<any>(null);
  const [direction, setDirection] = useState('');
  const [caption, setCaption] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  const [imageMime, setImageMime] = useState('image/png');
  const [imagePrompt, setImagePrompt] = useState('');
  const [generatingText, setGeneratingText] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);

  const fetchStatus = () => {
    fetch(`${API_BASE}/social/instagram/status`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.json()).then(setStatus).catch(() => setStatus({ connected: false }));
  };

  useEffect(() => { fetchStatus(); }, []);

  const generateText = async () => {
    if (!direction.trim()) return;
    setGeneratingText(true);
    try {
      const res = await fetch(`${API_BASE}/social/generate-text`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ direction, platform: 'instagram' }),
      });
      const d = await res.json();
      if (d.text) { setCaption(d.text); setImagePrompt(direction); }
      else alert(d.error || 'שגיאה');
    } finally { setGeneratingText(false); }
  };

  const generateImage = async () => {
    if (!imagePrompt.trim()) return;
    setGeneratingImage(true);
    try {
      const res = await fetch(`${API_BASE}/social/generate-image`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ prompt: imagePrompt, platform: 'instagram' }),
      });
      const d = await res.json();
      if (d.imageBase64) { setImageBase64(d.imageBase64); setImageMime(d.mimeType); }
      else alert(d.error || 'שגיאה ביצירת תמונה');
    } finally { setGeneratingImage(false); }
  };

  const copyCaption = () => {
    navigator.clipboard.writeText(caption);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const publish = async () => {
    if (!caption.trim() || !imageBase64) return;
    setPublishing(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/social/publish/instagram`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ caption, imageBase64, mimeType: imageMime }),
      });
      const d = await res.json();
      if (d.success) { setResult({ success: true }); setCaption(''); setImageBase64(''); setDirection(''); }
      else setResult({ error: d.error });
    } finally { setPublishing(false); }
  };

  const canPublish = status?.connected && caption.trim() && imageBase64;

  return (
    <div className="p-6 max-w-3xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}>
          <Instagram size={24} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">אינסטגרם</h1>
          <p className="text-gray-500 text-sm">פרסום פוסטים לאינסטגרם דרך ההייטק</p>
        </div>
        <button onClick={fetchStatus} className="btn btn-outline btn-sm mr-auto">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Status */}
      <div className={`card border p-4 mb-5 ${status?.connected ? 'border-pink-200 bg-pink-50' : 'border-yellow-200 bg-yellow-50'}`}>
        <div className="flex items-center gap-2">
          {status?.connected
            ? <><CheckCircle size={20} className="text-pink-500" /><span className="font-medium">@{status.username} · {status.followers?.toLocaleString()} עוקבים</span></>
            : <><XCircle size={20} className="text-yellow-500" /><span className="font-medium text-yellow-700">{status?.message || 'חשבון אינסטגרם עסקי לא מחובר לדף הפייסבוק'}</span></>
          }
        </div>
        {!status?.connected && (
          <p className="text-xs text-yellow-600 mt-1">כדי לאפשר פרסום אוטומטי: חבר חשבון Instagram Business לדף הפייסבוק של דרך ההייטק</p>
        )}
      </div>

      {/* AI Text Generator */}
      <div className="card bg-base-100 shadow-sm border border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50 p-5 mb-4">
        <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Sparkles size={18} className="text-purple-500" /> צור כיתוב עם AI
        </h2>
        <div className="flex flex-col gap-2">
          <textarea
            className="textarea textarea-bordered w-full text-right"
            rows={3}
            placeholder='לדוגמה: "פרויקט Scratch של תלמידי כיתה ג׳ — כיתוב עם הרבה אנרגיה ו-hashtags"'
            value={direction}
            onChange={e => setDirection(e.target.value)}
          />
          <div className="flex justify-start">
            <button onClick={generateText} disabled={generatingText || !direction.trim()}
              className="btn btn-sm bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 gap-1">
              {generatingText ? <span className="loading loading-spinner loading-xs" /> : <Sparkles size={14} />}
              {generatingText ? 'כותב…' : 'צור כיתוב'}
            </button>
          </div>
        </div>
      </div>

      {/* Caption */}
      <div className="card bg-base-100 shadow-sm border border-base-200 p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-700 flex items-center gap-2">
            <Send size={18} className="text-pink-500" /> כיתוב
          </h2>
          {caption && (
            <button onClick={copyCaption} className="btn btn-xs btn-outline gap-1">
              <Copy size={12} /> {copied ? '✓ הועתק' : 'העתק'}
            </button>
          )}
        </div>
        <textarea
          className="textarea textarea-bordered w-full text-right"
          rows={10}
          placeholder="כתוב כיתוב או צור עם AI למעלה... 📸"
          value={caption}
          onChange={e => setCaption(e.target.value)}
        />
        <p className="text-xs text-gray-400 mt-1 text-left">{caption.length} / 2,200</p>
      </div>

      {/* AI Image Generator */}
      <div className="card bg-base-100 shadow-sm border border-green-200 bg-green-50 p-5 mb-4">
        <h2 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <Image size={18} className="text-green-600" /> צור תמונה עם Gemini AI
          <span className="badge badge-warning badge-sm">נדרש לאינסטגרם</span>
        </h2>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            className="input input-bordered flex-1 text-right"
            placeholder='לדוגמה: "ילדים שמחים לומדים Python"'
            value={imagePrompt}
            onChange={e => setImagePrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && generateImage()}
          />
          <button onClick={generateImage} disabled={generatingImage || !imagePrompt.trim()}
            className="btn btn-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 gap-1">
            {generatingImage ? <span className="loading loading-spinner loading-xs" /> : <Image size={14} />}
            {generatingImage ? 'יוצר…' : 'צור תמונה'}
          </button>
        </div>
        {imageBase64 && (
          <div className="text-center">
            <img src={`data:${imageMime};base64,${imageBase64}`} alt="generated" className="rounded-xl max-w-xs mx-auto border shadow-sm" />
            <div className="flex gap-2 mt-2 justify-center">
              <a href={`data:${imageMime};base64,${imageBase64}`} download="instagram-post.png" className="btn btn-xs btn-outline">⬇️ הורד</a>
              <button onClick={() => setImageBase64('')} className="btn btn-xs btn-ghost text-red-500">🗑️ הסר</button>
            </div>
          </div>
        )}
        {!imageBase64 && (
          <p className="text-xs text-gray-400">אינסטגרם מחייב תמונה בכל פוסט</p>
        )}
      </div>

      {/* Publish */}
      <div className="flex items-center justify-between p-4 bg-base-100 rounded-xl border border-base-200 shadow-sm">
        <div>
          {result?.success && <span className="text-green-600 font-medium">✅ פורסם בהצלחה! 🎉</span>}
          {result?.error && <span className="text-red-500 text-sm">{result.error}</span>}
          {!result && !imageBase64 && caption && <span className="text-yellow-600 text-sm">⚠️ חסרה תמונה</span>}
        </div>
        <div className="flex gap-2">
          {!status?.connected && imageBase64 && (
            <a href={`data:${imageMime};base64,${imageBase64}`} download="instagram.png"
              className="btn btn-outline btn-sm gap-1">
              <Image size={14} /> הורד תמונה
            </a>
          )}
          {status?.connected && (
            <button onClick={publish} disabled={publishing || !canPublish}
              className="btn text-white hover:opacity-90 disabled:opacity-50 gap-2"
              style={{ background: 'linear-gradient(135deg, #f09433, #dc2743, #bc1888)' }}>
              {publishing ? <span className="loading loading-spinner loading-sm" /> : <Send size={16} />}
              פרסם באינסטגרם
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
