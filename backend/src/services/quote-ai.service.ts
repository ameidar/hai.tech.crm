import OpenAI from 'openai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

interface QuoteItemForAI {
  courseName: string;
  groups: number;
  meetingsPerGroup: number;
  meetingDuration: number;
  pricePerMeeting: number;
  subtotal: number;
}

interface QuoteForAI {
  institutionName: string;
  contactName: string;
  contactRole?: string | null;
  finalAmount: number;
  items: QuoteItemForAI[];
}

export async function generateQuoteAIContent(quote: QuoteForAI): Promise<string> {
  if (!openai) {
    throw new Error('OpenAI API key not configured. Cannot generate AI content.');
  }

  const itemsText = quote.items.map((item) =>
    `- ${item.courseName} - ${item.groups} קבוצות × ${item.meetingsPerGroup} מפגשים × ${item.meetingDuration} דקות למפגש, מחיר למפגש: ${item.pricePerMeeting} ₪`
  ).join('\n');

  const contactInfo = quote.contactRole
    ? `${quote.contactName}, ${quote.contactRole}`
    : quote.contactName;

  const prompt = `אתה כותב הצעות מחיר מקצועיות עבור חברת "דרך ההייטק" - חברה המתמחה בהכשרות טכנולוגיות ו-AI לבתי ספר וארגונים.

פרטי המוסד: ${quote.institutionName}
איש קשר: ${contactInfo}

קורסים שנבחרו:
${itemsText}

סה"כ: ${quote.finalAmount} ₪

כתוב הצעת מחיר מקצועית הכוללת:
1. מבוא על חברת "דרך ההייטק" - החברה מתמחה בהכשרות טכנולוגיות לבתי ספר עם דגש על פיתוח מיומנויות המוכנות לעידן הדיגיטלי, עם ניסיון עשיר בתחום החינוך וביסוס על חדשנות פדגוגית
2. ניתוח צרכים - מותאם לסוג המוסד ולקורסים שנבחרו
3. תיאור כל קורס - למה הוא מתאים, מטרות למידה, פעילויות מרכזיות, תוצאות צפויות
4. טבלת תמחור מסודרת
5. סיכום והמלצות למימוש

הטון: מקצועי, חם, משכנע. כתוב בעברית תקנית.
פורמט: Markdown.`;

  console.log('[QuoteAI] Generating quote content...');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'user', content: prompt },
    ],
    max_tokens: 3000,
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content || '';
  console.log(`[QuoteAI] Generated ${content.length} characters`);

  return content;
}
