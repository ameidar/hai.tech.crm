import axios from 'axios';
import OpenAI from 'openai';
import { AudienceFilters } from './campaigns.service.js';

export interface ContentVariant {
  subject: string;
  contentHtml: string;
  contentWa: string;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function researchTrends(audienceDesc: string): Promise<string> {
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  if (!perplexityKey) return '';

  try {
    const response = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model: 'sonar',
        messages: [
          {
            role: 'user',
            content: `מחקר מגמות שיווקיות לחוגי תכנות לילדים בישראל עבור: ${audienceDesc}. 
            תן תובנות קצרות על: 1) מה מעניין הורים בתחום 2) מגמות עדכניות בחינוך טכנולוגי 3) איך לשכנע הורים להירשם לחוג. 
            תשובה קצרה ב-3-4 משפטים בעברית.`,
          },
        ],
        max_tokens: 300,
      },
      {
        headers: {
          Authorization: `Bearer ${perplexityKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('Perplexity research error:', err);
    return '';
  }
}

async function generateCampaignContent(params: {
  audienceDesc: string;
  trends: string;
  channel: string;
  courseNames: string[];
  ageRange: string;
  userContext?: string;
}): Promise<ContentVariant[]> {
  const { audienceDesc, trends, channel, courseNames, ageRange, userContext } = params;

  const prompt = `אתה מומחה שיווק עבור "דרך ההייטק" - עסק לחוגי תכנות לילדים בישראל.

צור 3 גרסאות שונות של תוכן קמפיין שיווקי לקהל: ${audienceDesc}
קורסים: ${courseNames.join(', ') || 'חוגי תכנות'}
גיל: ${ageRange}

${trends ? `מגמות עדכניות: ${trends}` : ''}${userContext ? `\n\nהנחיות נוספות מהמנהל: ${userContext}` : ''}

כל גרסה חייבת לכלול:
1. subject - שורת נושא למייל (עברית, מושכת, עד 60 תווים)  
2. contentHtml - תוכן HTML למייל (עברית, מקצועי+חמים, עם {שם_הורה} ו-{שם_ילד} כ-placeholder, כולל כפתור CTA)
3. contentWa - הודעת WhatsApp (עברית, קצרה, 2-3 פסקאות, עם {שם_הורה} ו-{שם_ילד})

החזר JSON בדיוק בפורמט הזה, ללא טקסט נוסף:
{
  "variants": [
    {
      "subject": "...",
      "contentHtml": "...",
      "contentWa": "..."
    },
    {
      "subject": "...",
      "contentHtml": "...",
      "contentWa": "..."
    },
    {
      "subject": "...",
      "contentHtml": "...",
      "contentWa": "..."
    }
  ]
}

דגשים:
- טון חמים ומקצועי
- דגש על יתרונות הלמידה לילדים
- צור כפתור בHTML: <a href="https://derech-hitech.co.il" style="background:#4F46E5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0">לפרטים ורישום</a>
- HTML עם dir="rtl" ו-font-family בעברית`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.8,
  });

  const content = response.choices[0]?.message?.content || '{"variants":[]}';
  const parsed = JSON.parse(content);
  return parsed.variants || [];
}

export async function generateCampaignAI(
  filters: AudienceFilters,
  courses: { id: string; name: string }[],
  branches: { id: string; name: string }[],
  userContext?: string
): Promise<ContentVariant[]> {
  const courseNames = filters.courseIds
    ? courses.filter(c => filters.courseIds!.includes(c.id)).map(c => c.name)
    : courses.map(c => c.name);

  const branchNames = filters.branchIds
    ? branches.filter(b => filters.branchIds!.includes(b.id)).map(b => b.name)
    : [];

  const ageRange =
    filters.ageMin !== undefined || filters.ageMax !== undefined
      ? `${filters.ageMin || 5}-${filters.ageMax || 18} שנים`
      : 'כל הגילאים';

  const audienceDesc = [
    courseNames.length ? `קורסים: ${courseNames.join(', ')}` : '',
    branchNames.length ? `סניפים: ${branchNames.join(', ')}` : '',
    `גיל: ${ageRange}`,
    filters.cycleStatus && filters.cycleStatus !== 'all'
      ? `סטטוס: ${filters.cycleStatus === 'active' ? 'מחזורים פעילים' : 'מחזורים שהסתיימו'}`
      : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const trends = await researchTrends(audienceDesc);
  const variants = await generateCampaignContent({
    audienceDesc,
    trends,
    channel: 'both',
    courseNames,
    ageRange,
    userContext,
  });

  return variants;
}
