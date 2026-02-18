import OpenAI from 'openai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

interface QuoteItemForAI {
  courseName: string;
  type: 'education' | 'project';
  description?: string;
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
  includesVat?: boolean;
  items: QuoteItemForAI[];
}

export async function generateQuoteAIContent(quote: QuoteForAI): Promise<string> {
  if (!openai) {
    throw new Error('OpenAI API key not configured. Cannot generate AI content.');
  }

  const educationItems = quote.items.filter(i => i.type === 'education');
  const projectItems = quote.items.filter(i => i.type === 'project');

  const educationText = educationItems.map((item) =>
    `- ${item.courseName} - ${item.groups} קבוצות × ${item.meetingsPerGroup} מפגשים × ${item.meetingDuration} דקות למפגש, מחיר למפגש: ${item.pricePerMeeting} ₪`
  ).join('\n');

  const projectText = projectItems.map((item) =>
    `- ${item.courseName}${item.description ? ` (${item.description})` : ''} - מחיר: ${item.subtotal} ₪`
  ).join('\n');

  const contactInfo = quote.contactRole
    ? `${quote.contactName}, ${quote.contactRole}`
    : quote.contactName;

  let itemsSection = '';
  if (educationItems.length > 0) {
    itemsSection += `\nקורסים והכשרות (מה שדרך ההייטק מלמדת):\n${educationText}`;
  }
  if (projectItems.length > 0) {
    itemsSection += `\nפרויקטים ועבודות אוטומציה (מה שדרך ההייטק בונה):\n${projectText}`;
  }

  let contentInstructions = '';
  if (educationItems.length > 0 && projectItems.length > 0) {
    contentInstructions = `ההצעה כוללת גם קורסים/הכשרות וגם פרויקטים/עבודות אוטומציה. עבור הקורסים - תאר מטרות למידה, פעילויות מרכזיות ותוצאות צפויות. עבור הפרויקטים - תאר את הפתרון הטכנולוגי, יתרונות, שלבי העבודה ותוצרים.`;
  } else if (projectItems.length > 0) {
    contentInstructions = `ההצעה היא עבור פרויקטים ועבודות אוטומציה שדרך ההייטק בונה. תאר את הפתרון הטכנולוגי, יתרונות, שלבי העבודה, תוצרים צפויים ולוחות זמנים.`;
  } else {
    contentInstructions = `ההצעה היא עבור קורסים והכשרות טכנולוגיות שדרך ההייטק מלמדת. תאר מטרות למידה, פעילויות מרכזיות, תוצאות צפויות והתאמה למוסד.`;
  }

  const prompt = `אתה כותב הצעות מחיר מקצועיות עבור חברת "דרך ההייטק בע״מ" - חברה המתמחה בהכשרות טכנולוגיות, AI ופרויקטי אוטומציה לבתי ספר וארגונים.

פרטי המוסד: ${quote.institutionName}
איש קשר: ${contactInfo}
${itemsSection}

סה"כ: ${quote.finalAmount} ₪ ${quote.includesVat ? '(כולל מע״מ 18%)' : '(לא כולל מע״מ)'}

${contentInstructions}

כתוב הצעת מחיר מקצועית הכוללת:
1. מבוא על חברת "דרך ההייטק בע״מ" - החברה מתמחה בהכשרות טכנולוגיות ובפרויקטי אוטומציה, עם ניסיון עשיר בתחום החינוך והטכנולוגיה
2. ניתוח צרכים - מותאם לסוג המוסד ולפריטים שנבחרו
3. תיאור כל פריט - מותאם לסוג (קורס או פרויקט)
4. טבלת תמחור מסודרת — ${quote.includesVat ? 'המחירים כוללים מע״מ 18%, ציין זאת בטבלה' : 'המחירים לא כוללים מע״מ, הוסף שורת מע״מ 18% ושורת סה״כ כולל מע״מ'}
5. סיכום והמלצות למימוש
6. סיום עם חתימת החברה: "בברכה, דרך ההייטק בע״מ"

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
