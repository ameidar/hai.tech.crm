import { useState } from 'react';
import { Sparkles, Copy, Image, CheckCircle, Play } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
function getToken() { return localStorage.getItem('accessToken') || ''; }
const headers = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

function YouTubeIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
}

interface VideoMeta {
  title: string;
  description: string;
  tags: string;
  chapters: string;
}

export default function YouTubePage() {
  const [direction, setDirection] = useState('');
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [imageBase64, setImageBase64] = useState('');
  const [imageMime, setImageMime] = useState('image/png');
  const [imagePrompt, setImagePrompt] = useState('');
  const [generatingText, setGeneratingText] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [copied, setCopied] = useState<string>('');

  const generateContent = async () => {
    if (!direction.trim()) return;
    setGeneratingText(true);
    try {
      const res = await fetch(`${API_BASE}/social/generate-text`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ direction, platform: 'youtube' }),
      });
      const d = await res.json();
      if (d.text) {
        // Parse JSON response from AI
        try {
          const parsed = JSON.parse(d.text);
          setVideoMeta(parsed);
          setImagePrompt(parsed.title || direction);
        } catch {
          // Fallback if not JSON
          setVideoMeta({ title: direction, description: d.text, tags: '', chapters: '' });
        }
      } else alert(d.error || 'שגיאה');
    } finally { setGeneratingText(false); }
  };

  const generateImage = async () => {
    if (!imagePrompt.trim()) return;
    setGeneratingImage(true);
    try {
      const res = await fetch(`${API_BASE}/social/generate-image`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ prompt: imagePrompt, platform: 'youtube' }),
      });
      const d = await res.json();
      if (d.imageBase64) { setImageBase64(d.imageBase64); setImageMime(d.mimeType); }
      else alert(d.error || 'שגיאה');
    } finally { setGeneratingImage(false); }
  };

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  const CopyBtn = ({ k, text }: { k: string; text: string }) => (
    <button onClick={() => copy(k, text)} className="btn btn-xs btn-outline gap-1">
      {copied === k ? <><CheckCircle size={12} /> הועתק</> : <><Copy size={12} /> העתק</>}
    </button>
  );

  return (
    <div className="p-6 max-w-3xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-[#FF0000] rounded-lg flex items-center justify-center text-white">
          <YouTubeIcon size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold">YouTube</h1>
          <p className="text-gray-500 text-sm">יצירת כותרת, תיאור, תגיות ו-Thumbnail לסרטון</p>
        </div>
        <span className="badge badge-warning mr-auto">📋 יצירה ידנית</span>
      </div>

      {/* Info */}
      <div className="alert alert-info mb-5 text-sm">
        <span>💡 YouTube מחייב העלאת סרטון — ה-AI יכין כותרת, תיאור, תגיות ו-Thumbnail. העלה דרך YouTube Studio.</span>
      </div>

      {/* AI Generator */}
      <div className="card bg-base-100 shadow-sm border border-purple-200 bg-gradient-to-br from-purple-50 to-red-50 p-5 mb-4">
        <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Sparkles size={18} className="text-purple-500" /> צור מטא-דאטה לסרטון
        </h2>
        <div className="flex flex-col gap-2">
          <textarea
            className="textarea textarea-bordered w-full text-right"
            rows={3}
            placeholder='לדוגמה: "סרטון על ילדה בת 10 שיצרה משחק ב-Scratch תוך חודש"'
            value={direction}
            onChange={e => setDirection(e.target.value)}
          />
          <div className="flex justify-start">
            <button onClick={generateContent} disabled={generatingText || !direction.trim()}
              className="btn btn-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 gap-1">
              {generatingText ? <span className="loading loading-spinner loading-xs" /> : <Play size={14} />}
              {generatingText ? 'מייצר…' : 'צור מטא-דאטה'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {videoMeta && (
        <div className="space-y-4 mb-4">
          {/* Title */}
          <div className="card bg-base-100 border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm">🎯 כותרת</span>
              <CopyBtn k="title" text={videoMeta.title} />
            </div>
            <input className="input input-bordered w-full text-right" value={videoMeta.title}
              onChange={e => setVideoMeta({ ...videoMeta, title: e.target.value })} />
          </div>

          {/* Description */}
          <div className="card bg-base-100 border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm">📝 תיאור</span>
              <CopyBtn k="desc" text={videoMeta.description} />
            </div>
            <textarea className="textarea textarea-bordered w-full text-right" rows={8}
              value={videoMeta.description}
              onChange={e => setVideoMeta({ ...videoMeta, description: e.target.value })} />
          </div>

          {/* Tags */}
          <div className="card bg-base-100 border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm">🏷️ תגיות</span>
              <CopyBtn k="tags" text={videoMeta.tags} />
            </div>
            <input className="input input-bordered w-full text-right text-sm" value={videoMeta.tags}
              onChange={e => setVideoMeta({ ...videoMeta, tags: e.target.value })} />
          </div>

          {/* Chapters */}
          {videoMeta.chapters && (
            <div className="card bg-base-100 border p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">📑 פרקים (Chapters)</span>
                <CopyBtn k="chapters" text={videoMeta.chapters} />
              </div>
              <textarea className="textarea textarea-bordered w-full text-right font-mono text-sm" rows={5}
                value={videoMeta.chapters}
                onChange={e => setVideoMeta({ ...videoMeta, chapters: e.target.value })} />
            </div>
          )}
        </div>
      )}

      {/* Thumbnail Generator */}
      <div className="card bg-base-100 shadow-sm border border-green-200 bg-green-50 p-5 mb-4">
        <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Image size={18} className="text-green-600" /> צור Thumbnail עם Gemini AI
          <span className="badge badge-ghost badge-sm">1280×720</span>
        </h2>
        <div className="flex flex-col gap-2">
          <textarea
            className="textarea textarea-bordered w-full text-right"
            rows={2}
            placeholder='לדוגמה: "ילדה מחייכת עם קוד על מסך, כותרת בצבע צהוב"'
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
              className="rounded-xl max-w-full mx-auto border shadow" style={{ maxHeight: 240 }} />
            <div className="flex gap-2 mt-2 justify-center">
              <a href={`data:${imageMime};base64,${imageBase64}`} download="youtube-thumbnail.png"
                className="btn btn-xs btn-outline">⬇️ הורד (PNG)</a>
              <button onClick={() => setImageBase64('')} className="btn btn-xs btn-ghost text-red-500">🗑️ הסר</button>
            </div>
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="card bg-gray-50 border p-4 text-sm text-gray-600">
        <p className="font-semibold mb-2">🎬 שלבים לפרסום ב-YouTube:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>צלם/ערוך את הסרטון</li>
          <li>נכנס ל-<a href="https://studio.youtube.com" target="_blank" rel="noreferrer" className="text-red-600 underline">YouTube Studio</a></li>
          <li>לחץ "צור" → "העלה סרטונים"</li>
          <li>הדבק את הכותרת, תיאור, תגיות</li>
          <li>העלה את ה-Thumbnail</li>
          <li>הוסף פרקים בתיאור</li>
          <li>פרסם!</li>
        </ol>
      </div>
    </div>
  );
}
