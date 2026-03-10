/**
 * Lesson AI Service
 * Generates lesson plans for instructors based on course materials and AI knowledge
 */

import OpenAI from 'openai';
import { listDriveFolder, uploadLessonPlan } from './google-drive.js';
import { prisma } from '../utils/prisma.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface LessonPlanRequest {
  courseId?: string;
  courseName: string;
  materialsFolderId?: string | null;
  ageGroup: string;           // e.g. "כיתות ג-ד (8-10)"
  cycleName?: string;         // e.g. "מחזור 3 - חולון"
  topic?: string;             // Optional: specific topic/lesson number
  language?: string;          // default: he
  userId: string;
  userName?: string;
}

export interface LessonPlanResult {
  content: string;            // Markdown lesson plan
  usedDrive: boolean;
  driveFiles: string[];       // file names used as context
  logId: string;
  driveFileId?: string;       // ID of uploaded file in Drive
  driveFileUrl?: string;      // URL to open the uploaded file
}

/**
 * Recursively list Drive files up to 2 levels deep
 */
async function getDriveMaterials(folderId: string, depth = 0): Promise<string[]> {
  try {
    const files = await listDriveFolder(folderId);
    const names: string[] = [];
    for (const f of files) {
      names.push(f.name);
      if (f.isFolder && depth < 1) {
        const sub = await getDriveMaterials(f.id, depth + 1);
        sub.slice(0, 10).forEach(n => names.push(`  ↳ ${n}`));
      }
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * Build system prompt for the AI
 */
function buildPrompt(req: LessonPlanRequest, driveFiles: string[]): string {
  const hasDrive = driveFiles.length > 0;

  const driveSection = hasDrive
    ? `\n\n## חומרי הלימוד הזמינים לקורס זה (ב-Google Drive שלנו):\n${driveFiles.map(f => `- ${f}`).join('\n')}\n\nאם רלוונטי, ציין בסוף ה-מערך "📁 חומר מומלץ לעיון: [שם הקובץ]".`
    : '\n\n(אין חומרים ספציפיים קיימים ב-Drive לקורס זה — צור מערך מקורי מהידע שלך.)';

  return `אתה סוכן לימודים AI מומחה לקורסי תכנות לילדים של "דרך ההייטק".

## פרטי השיעור המבוקש:
- **קורס:** ${req.courseName}
- **גיל הילדים:** ${req.ageGroup}
${req.cycleName ? `- **מחזור:** ${req.cycleName}` : ''}
${req.topic ? `- **נושא/בקשה:** ${req.topic}` : '- **נושא:** שיעור כללי מתאים לרמה'}
${driveSection}

## הנחיות:
1. צור מערך שיעור מלא ומפורט ב**עברית** (75-90 דקות)
2. כולל: פתיחה, הסבר תיאורטי, פעילות מעשית, סיכום
3. התאם לגיל: ${req.ageGroup}
4. כולל קוד לדוגמה אם רלוונטי (ב-\`\`\` blocks)
5. כולל שאלות לבדיקת הבנה
6. פורמט Markdown עם כותרות ברורות
7. בסוף — רשימת חומרים שנדרשים (אם יש)`;
}

/**
 * Generate a lesson plan using AI
 */
export async function generateLessonPlan(req: LessonPlanRequest): Promise<LessonPlanResult> {
  // 1. Fetch Drive materials if available
  let driveFiles: string[] = [];
  if (req.materialsFolderId) {
    driveFiles = await getDriveMaterials(req.materialsFolderId);
  }
  const usedDrive = driveFiles.length > 0;

  // 2. Build prompt
  const systemPrompt = buildPrompt(req, driveFiles);

  // 3. Call GPT-4o
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: req.topic
          ? `צור מערך שיעור על הנושא: ${req.topic}`
          : `צור מערך שיעור מתאים לרמה ולגיל`,
      },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });

  const content = completion.choices[0]?.message?.content || 'לא ניתן לייצר מערך שיעור כרגע.';

  // 4. Build full content with instructor attribution header
  const dateStr = new Date().toLocaleDateString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const attribution = [
    `נוצר על ידי: ${req.userName || req.userId}`,
    `תאריך: ${dateStr}`,
    `קורס: ${req.courseName}`,
    `גיל הלומדים: ${req.ageGroup}`,
    req.cycleName ? `מחזור: ${req.cycleName}` : null,
    req.topic ? `נושא: ${req.topic}` : null,
    '---',
    '',
  ].filter(Boolean).join('\n');

  const fullContent = attribution + content;

  // 5. Upload to Google Drive (best effort — don't fail if Drive upload fails)
  let driveFileId: string | undefined;
  let driveFileUrl: string | undefined;
  try {
    const safeCourseName = req.courseName.replace(/[^א-תa-zA-Z0-9 ]/g, '').trim();
    const title = `מערך שיעור — ${safeCourseName} — ${req.userName || 'מדריך'} — ${dateStr}`;
    const uploaded = await uploadLessonPlan({
      title,
      content: fullContent,
      courseFolderId: req.materialsFolderId,
    });
    driveFileId = uploaded.fileId;
    driveFileUrl = uploaded.webViewLink;
    console.log(`[LessonAI] Uploaded to Drive: ${driveFileId}`);
  } catch (err) {
    console.error('[LessonAI] Drive upload failed (non-fatal):', err);
  }

  // 6. Save to DB
  const log = await prisma.aiLessonLog.create({
    data: {
      userId: req.userId,
      userName: req.userName,
      courseId: req.courseId,
      courseName: req.courseName,
      cycleName: req.cycleName,
      ageGroup: req.ageGroup,
      topic: req.topic,
      usedDrive,
      driveFiles: usedDrive ? JSON.stringify(driveFiles.slice(0, 20)) : null,
      response: fullContent,
    },
  });

  return { content: fullContent, usedDrive, driveFiles, logId: log.id, driveFileId, driveFileUrl };
}
