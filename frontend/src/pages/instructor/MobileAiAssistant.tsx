/**
 * AI Learning Assistant — Instructor view
 * Generates lesson plans based on course, age group, and topic
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Sparkles, BookOpen, ChevronDown, Loader2, Copy, Check, AlertCircle, ExternalLink } from 'lucide-react';
import api from '../../api/client';
import type { Course } from '../../types';

interface CoursesResponse {
  data: Course[];
}

interface GenerateRequest {
  courseId?: string;
  courseName: string;
  ageGroup: string;
  cycleName?: string;
  topic?: string;
}

interface GenerateResponse {
  content: string;
  usedDrive: boolean;
  driveFiles: string[];
  logId: string;
  driveFileId?: string;
  driveFileUrl?: string;
}

const AGE_GROUPS = [
  'כיתות א-ב (6-8)',
  'כיתות ג-ד (8-10)',
  'כיתות ה-ו (10-12)',
  'כיתות ז-ח (12-14)',
  'כיתות ט-י (14-16)',
  'תיכון (14-18)',
];

// Simple markdown renderer for the response
function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="space-y-1 text-sm leading-relaxed" dir="rtl">
      {lines.map((line, i) => {
        if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold text-gray-900 mt-4 mb-2">{line.slice(2)}</h1>;
        if (line.startsWith('## ')) return <h2 key={i} className="text-base font-bold text-blue-700 mt-3 mb-1 border-b border-blue-100 pb-1">{line.slice(3)}</h2>;
        if (line.startsWith('### ')) return <h3 key={i} className="text-sm font-semibold text-gray-800 mt-2">{line.slice(4)}</h3>;
        if (line.startsWith('```')) return <div key={i} className="font-mono text-xs bg-gray-800 text-green-400 px-3 py-1 rounded" />;
        if (line.startsWith('- ') || line.startsWith('* ')) return (
          <div key={i} className="flex gap-2 mr-2">
            <span className="text-blue-500 shrink-0 mt-1">•</span>
            <span className="text-gray-700">{line.slice(2)}</span>
          </div>
        );
        if (/^\d+\./.test(line)) return (
          <div key={i} className="flex gap-2 mr-2">
            <span className="text-blue-500 shrink-0 font-medium">{line.match(/^\d+/)?.[0]}.</span>
            <span className="text-gray-700">{line.replace(/^\d+\.\s*/, '')}</span>
          </div>
        );
        if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-semibold text-gray-900">{line.slice(2, -2)}</p>;
        if (line === '') return <div key={i} className="h-1" />;
        // Handle inline bold
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i} className="text-gray-700">
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        );
      })}
    </div>
  );
}

export default function MobileAiAssistant() {
  const [courseId, setCourseId] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [cycleName, setCycleName] = useState('');
  const [topic, setTopic] = useState('');
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: coursesData, isLoading: coursesLoading } = useQuery<CoursesResponse>({
    queryKey: ['courses-for-ai'],
    queryFn: async () => {
      const res = await api.get<CoursesResponse>('/courses?limit=200&isActive=true');
      return res.data;
    },
    staleTime: 10 * 60 * 1000,
  });

  const courses = coursesData?.data || [];
  const selectedCourse = courses.find(c => c.id === courseId);

  const generateMutation = useMutation({
    mutationFn: async (req: GenerateRequest) => {
      const res = await api.post<GenerateResponse>('/lesson-ai/generate', req);
      return res.data;
    },
    onSuccess: (data) => {
      setResult(data);
    },
  });

  const handleGenerate = () => {
    if (!ageGroup) return;
    const courseName = selectedCourse?.name || 'קורס כללי';
    generateMutation.mutate({
      courseId: courseId || undefined,
      courseName,
      ageGroup,
      cycleName: cycleName || undefined,
      topic: topic || undefined,
    });
  };

  const handleCopy = async () => {
    if (!result?.content) return;
    await navigator.clipboard.writeText(result.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isLoading = generateMutation.isPending;
  const error = generateMutation.error;

  return (
    <div className="min-h-full bg-gray-50" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-purple-600 to-blue-600 text-white px-4 py-5">
        <div className="flex items-center gap-3 mb-1">
          <Sparkles size={24} />
          <h1 className="text-xl font-bold">סוכן לימודים AI</h1>
        </div>
        <p className="text-white/80 text-sm">מייצר מערך שיעור מותאם אישית</p>
      </div>

      <div className="p-4 space-y-4">
        {/* Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-4">
          {/* Course selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <BookOpen size={14} className="inline ml-1" />קורס
            </label>
            <div className="relative">
              <select
                value={courseId}
                onChange={e => setCourseId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 pr-8 text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                disabled={coursesLoading}
              >
                <option value="">קורס כללי (ללא חומרים)</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.materialsFolderId ? '📁' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            {selectedCourse?.materialsFolderId && (
              <p className="text-xs text-green-600 mt-1">📁 יש חומרים ב-Drive — הסוכן ישתמש בהם</p>
            )}
          </div>

          {/* Age group */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">גיל התלמידים *</label>
            <div className="relative">
              <select
                value={ageGroup}
                onChange={e => setAgeGroup(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 pr-8 text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="">בחר גיל...</option>
                {AGE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Cycle name (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">שם המחזור (אופציונלי)</label>
            <input
              type="text"
              value={cycleName}
              onChange={e => setCycleName(e.target.value)}
              placeholder="לדוגמה: מחזור 3 - חולון"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Topic */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">נושא / בקשה ספציפית</label>
            <textarea
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="לדוגמה: שיעור 5 על לולאות, פעילות יצירתית על AI, משחק קידוד..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
              rows={2}
            />
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!ageGroup || isLoading}
            className="w-full bg-gradient-to-l from-purple-600 to-blue-600 text-white py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                מייצר מערך שיעור...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                {result ? 'צור מערך חדש' : 'צור מערך שיעור'}
              </>
            )}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2 text-red-700 text-sm">
            <AlertCircle size={16} />
            שגיאה ביצירת המערך — נסה שוב
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Result header */}
            <div className="bg-gradient-to-l from-purple-50 to-blue-50 px-4 py-3 border-b">
              <div className="flex items-center justify-between mb-1">
                <p className="font-medium text-gray-800 text-sm">✅ מערך שיעור מוכן</p>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors px-2 py-1 rounded-lg hover:bg-blue-50"
                >
                  {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  {copied ? 'הועתק!' : 'העתק'}
                </button>
              </div>
              {result.usedDrive && (
                <p className="text-xs text-green-600">📁 נוצר בהתבסס על {result.driveFiles.length} חומרים מ-Drive</p>
              )}
              {!result.usedDrive && (
                <p className="text-xs text-purple-600">✨ נוצר מידע AI</p>
              )}
              {result.driveFileUrl ? (
                <a
                  href={result.driveFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                >
                  <ExternalLink size={12} />
                  נשמר ב-Drive — לחץ לפתיחה
                </a>
              ) : (
                <p className="text-xs text-gray-400 mt-1">⏳ שמירה ל-Drive בתהליך...</p>
              )}
            </div>

            {/* Content */}
            <div className="p-4">
              <MarkdownContent content={result.content} />
            </div>
          </div>
        )}

        {/* Bottom spacing */}
        <div className="h-4" />
      </div>
    </div>
  );
}
