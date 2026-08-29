import { useEffect, useState } from 'react';
import { Sparkles, Copy, Image, CheckCircle, Play, Upload, ExternalLink, AlertCircle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
function getToken() { return localStorage.getItem('accessToken') || ''; }
const headers = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' });
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

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

interface YouTubeStatus {
  connected: boolean;
  channelId?: string;
  channelTitle?: string | null;
  message?: string;
  error?: string;
  warning?: string;
}

interface PublishResult {
  videoId: string;
  url: string;
  privacyStatus: string;
  thumbnailWarning?: string | null;
}

function base64ToFile(base64: string, mimeType: string, filename: string) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes.charCodeAt(i);
  return new File([arr], filename, { type: mimeType });
}

export default function YouTubePage() {
  const [direction, setDirection] = useState('');
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [imageBase64, setImageBase64] = useState('');
  const [imageMime, setImageMime] = useState('image/png');
  const [imagePrompt, setImagePrompt] = useState('');
  const [generatingText, setGeneratingText] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [youtubeStatus, setYoutubeStatus] = useState<YouTubeStatus | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState<'private' | 'unlisted' | 'public'>('private');
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [publishError, setPublishError] = useState('');
  const [copied, setCopied] = useState<string>('');

  useEffect(() => {
    fetch(`${API_BASE}/social/youtube/status`, { headers: authHeaders() })
      .then(res => res.json())
      .then(setYoutubeStatus)
      .catch(err => setYoutubeStatus({ connected: false, error: err.message }));
  }, []);

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

  const publishToYouTube = async () => {
    if (!videoFile || !videoMeta?.title.trim()) return;

    setPublishing(true);
    setPublishError('');
    setPublishResult(null);

    const description = [videoMeta.description, videoMeta.chapters].filter(Boolean).join('\n\n');
    const form = new FormData();
    form.append('video', videoFile);
    form.append('title', videoMeta.title);
    form.append('description', description);
    form.append('tags', videoMeta.tags || '');
    form.append('privacyStatus', privacyStatus);
    if (thumbnailFile) {
      form.append('thumbnail', thumbnailFile);
    } else if (imageBase64) {
      form.append('thumbnail', base64ToFile(imageBase64, imageMime, 'youtube-thumbnail.png'));
    }

    try {
      const res = await fetch(`${API_BASE}/social/publish/youtube`, {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'שגיאה בפרסום ל-YouTube');
      setPublishResult(d);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'שגיאה בפרסום ל-YouTube');
    } finally {
      setPublishing(false);
    }
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
          <p className="text-gray-500 text-sm">יצירת מטא-דאטה ופרסום סרטונים לערוץ</p>
        </div>
        <span className={`badge mr-auto ${youtubeStatus?.connected ? 'badge-success' : 'badge-warning'}`}>
          {youtubeStatus?.connected ? 'מחובר' : 'לא מחובר'}
        </span>
      </div>

      {/* Info */}
      <div className={`alert mb-5 text-sm ${youtubeStatus?.connected ? 'alert-success' : 'alert-warning'}`}>
        <span>
          {youtubeStatus?.connected
            ? `העלאה פעילה${youtubeStatus.channelTitle || youtubeStatus.channelId ? ` לערוץ: ${youtubeStatus.channelTitle || youtubeStatus.channelId}` : ''}${youtubeStatus.warning ? ` (לא ניתן לקרוא שם ערוץ: ${youtubeStatus.warning})` : ''}`
            : `חסר קונפיגורציית YouTube בשרת${youtubeStatus?.message || youtubeStatus?.error ? `: ${youtubeStatus.message || youtubeStatus.error}` : ''}`}
        </span>
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

      {/* YouTube Publisher */}
      <div className="card bg-base-100 shadow-sm border border-red-200 p-5 mb-4">
        <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Upload size={18} className="text-red-600" /> פרסום ל-YouTube
        </h2>
        <div className="grid gap-3">
          <label className="form-control w-full">
            <span className="label-text mb-1">קובץ וידאו</span>
            <input
              type="file"
              accept="video/*"
              className="file-input file-input-bordered w-full"
              onChange={e => setVideoFile(e.target.files?.[0] || null)}
            />
          </label>
          <label className="form-control w-full">
            <span className="label-text mb-1">Thumbnail אופציונלי</span>
            <input
              type="file"
              accept="image/*"
              className="file-input file-input-bordered w-full"
              onChange={e => setThumbnailFile(e.target.files?.[0] || null)}
            />
          </label>
          <label className="form-control w-full">
            <span className="label-text mb-1">פרטיות</span>
            <select
              className="select select-bordered w-full"
              value={privacyStatus}
              onChange={e => setPrivacyStatus(e.target.value as 'private' | 'unlisted' | 'public')}
            >
              <option value="private">פרטי</option>
              <option value="unlisted">לא רשום</option>
              <option value="public">ציבורי</option>
            </select>
          </label>
          <button
            onClick={publishToYouTube}
            disabled={publishing || !youtubeStatus?.connected || !videoFile || !videoMeta?.title.trim()}
            className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 gap-2"
          >
            {publishing ? <span className="loading loading-spinner loading-sm" /> : <Upload size={16} />}
            {publishing ? 'מעלה ומפרסם…' : 'פרסם ל-YouTube'}
          </button>
          {publishError && (
            <div className="alert alert-error text-sm">
              <AlertCircle size={16} />
              <span>{publishError}</span>
            </div>
          )}
          {publishResult && (
            <div className="alert alert-success text-sm">
              <CheckCircle size={16} />
              <div>
                <div>הסרטון פורסם בהצלחה ({publishResult.privacyStatus})</div>
                <a href={publishResult.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">
                  פתח ביוטיוב <ExternalLink size={12} />
                </a>
                {publishResult.thumbnailWarning && (
                  <div className="text-xs mt-1">הסרטון עלה, אבל ה-thumbnail לא עודכן: {publishResult.thumbnailWarning}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

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
        <p className="font-semibold mb-2">🎬 תהליך עבודה מומלץ:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>צלם/ערוך את הסרטון</li>
          <li>צור או ערוך כותרת, תיאור ותגיות</li>
          <li>צור Thumbnail או העלה קובץ תמונה מוכן</li>
          <li>בחר קובץ וידאו ופרטיות</li>
          <li>לחץ "פרסם ל-YouTube"</li>
        </ol>
      </div>
    </div>
  );
}
