import { useState } from 'react';
import { Sparkles, Copy, Image, CheckCircle, Music } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
function getToken() { return localStorage.getItem('accessToken') || ''; }
const headers = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

// TikTok icon (SVG)
function TikTokIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.79 1.54V6.78a4.85 4.85 0 01-1.02-.09z"/>
    </svg>
  );
}

export default function TikTokPage() {
  const [direction, setDirection] = useState('');
  const [script, setScript] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  const [imageMime, setImageMime] = useState('image/png');
  const [imagePrompt, setImagePrompt] = useState('');
  const [generatingText, setGeneratingText] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateScript = async () => {
    if (!direction.trim()) return;
    setGeneratingText(true);
    try {
      const res = await fetch(`${API_BASE}/social/generate-text`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ direction, platform: 'tiktok' }),
      });
      const d = await res.json();
      if (d.text) { setScript(d.text); setImagePrompt(direction); }
      else alert(d.error || 'שגיאה');
    } finally { setGeneratingText(false); }
  };

  const generateImage = async () => {
    if (!imagePrompt.trim()) return;
    setGeneratingImage(true);
    try {
      const res = await fetch(`${API_BASE}/social/generate-image`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ prompt: imagePrompt, platform: 'tiktok' }),
      });
      const d = await res.json();
      if (d.imageBase64) { setImageBase64(d.imageBase64); setImageMime(d.mimeType); }
      else alert(d.error || 'שגיאה');
    } finally { setGeneratingImage(false); }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center text-white">
          <TikTokIcon size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold">TikTok</h1>
          <p className="text-gray-500 text-sm">יצירת תסריט וthumbnail לסרטון TikTok</p>
        </div>
        <span className="badge badge-warning mr-auto">📋 יצירה ידנית</span>
      </div>

      {/* Info note */}
      <div className="alert alert-info mb-5 text-sm">
        <span>💡 TikTok מחייב העלאת סרטון — ה-AI יכין עבורך תסריט + thumbnail. תצלם ותעלה דרך האפליקציה.</span>
      </div>

      {/* AI Script Generator */}
      <div className="card bg-base-100 shadow-sm border border-purple-200 bg-gradient-to-br from-purple-50 to-black/5 p-5 mb-4">
        <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Sparkles size={18} className="text-purple-500" /> צור תסריט עם AI
        </h2>
        <div className="flex flex-col gap-2">
          <textarea
            className="textarea textarea-bordered w-full text-right"
            rows={3}
            placeholder='לדוגמה: "להסביר מה זה Scratch לילדים בגיל 8 — בסגנון מהיר ומצחיק"'
            value={direction}
            onChange={e => setDirection(e.target.value)}
          />
          <div className="flex justify-start">
            <button onClick={generateScript} disabled={generatingText || !direction.trim()}
              className="btn btn-sm bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 gap-1">
              {generatingText ? <span className="loading loading-spinner loading-xs" /> : <Music size={14} />}
              {generatingText ? 'כותב…' : 'צור תסריט'}
            </button>
          </div>
        </div>
      </div>

      {/* Script result */}
      {script && (
        <div className="card bg-base-100 shadow-sm border border-base-200 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700 flex items-center gap-2">
              <Music size={18} className="text-black" /> תסריט + כיתוב
            </h2>
            <button onClick={() => copy(script)} className="btn btn-xs btn-outline gap-1">
              <Copy size={12} /> {copied ? <><CheckCircle size={12} /> הועתק</> : 'העתק הכל'}
            </button>
          </div>
          <textarea
            className="textarea textarea-bordered w-full text-right font-mono text-sm"
            rows={14}
            value={script}
            onChange={e => setScript(e.target.value)}
          />
        </div>
      )}

      {/* Thumbnail Generator */}
      <div className="card bg-base-100 shadow-sm border border-green-200 bg-green-50 p-5 mb-4">
        <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Image size={18} className="text-green-600" /> צור Thumbnail עם Gemini AI
        </h2>
        <div className="flex flex-col gap-2">
          <textarea
            className="textarea textarea-bordered w-full text-right"
            rows={2}
            placeholder='לדוגמה: "ילד מופתע מול מסך עם קוד Python, כותרת גדולה"'
            value={imagePrompt}
            onChange={e => setImagePrompt(e.target.value)}
          />
          <div className="flex justify-start">
            <button onClick={generateImage} disabled={generatingImage || !imagePrompt.trim()}
              className="btn btn-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 gap-1">
              {generatingImage ? <span className="loading loading-spinner loading-xs" /> : <Image size={14} />}
              {generatingImage ? 'יוצר…' : 'צור Thumbnail'}
            </button>
          </div>
        </div>
        {imageBase64 && (
          <div className="mt-3 text-center">
            <img src={`data:${imageMime};base64,${imageBase64}`} alt="thumbnail"
              className="rounded-xl max-w-xs mx-auto border shadow-sm" />
            <div className="flex gap-2 mt-2 justify-center">
              <a href={`data:${imageMime};base64,${imageBase64}`} download="tiktok-thumbnail.png"
                className="btn btn-xs btn-outline">⬇️ הורד Thumbnail</a>
              <button onClick={() => setImageBase64('')} className="btn btn-xs btn-ghost text-red-500">🗑️ הסר</button>
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="card bg-gray-50 border p-4 text-sm text-gray-600">
        <p className="font-semibold mb-2">📱 שלבים לפרסום ב-TikTok:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>צלם סרטון לפי התסריט</li>
          <li>הורד את ה-Thumbnail</li>
          <li>פתח TikTok → לחץ + → בחר סרטון</li>
          <li>העתק את הכיתוב וה-hashtags</li>
          <li>הוסף את ה-Thumbnail כ-cover</li>
          <li>פרסם!</li>
        </ol>
      </div>
    </div>
  );
}
