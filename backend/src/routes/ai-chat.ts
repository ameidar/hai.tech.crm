/**
 * AI Chat — Natural Language Interface to CRM Database
 * Role-based access: instructor (own data only), sales (leads/customers), manager (all)
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import OpenAI from 'openai';

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── DB Schema summary for GPT ─────────────────────────────────────────────
const DB_SCHEMA = `
PostgreSQL schema (relevant tables):

customers (id, name, phone, email, city, notes, created_at, deleted_at)
  → Filter active: WHERE deleted_at IS NULL

students (id, customer_id, name, age, created_at, deleted_at)
  → Filter active: WHERE deleted_at IS NULL

cycles (id, name, branch_id, instructor_id, start_date, end_date, status, day_of_week, start_time, end_time, max_students, deleted_at)
  → Filter active: WHERE deleted_at IS NULL
  → day_of_week enum values (lowercase only!): 'sunday','monday','tuesday','wednesday','thursday','friday','saturday'
  → status values: 'active','completed','cancelled','draft'

meetings (id, cycle_id, instructor_id, scheduled_date, start_time, end_time, status, zoom_join_url, lesson_transcript, created_at, deleted_at)
  → Filter active: WHERE deleted_at IS NULL
  → status values: 'scheduled','completed','cancelled'

registrations (id, cycle_id, customer_id, student_id, status, created_at, deleted_at)
  → Filter active: WHERE deleted_at IS NULL

instructors (id, user_id, name, email, phone, created_at)
  → NO deleted_at column — do NOT add WHERE deleted_at IS NULL

branches (id, name, city, created_at)
  → NO deleted_at column

lead_appointments (id, customer_name, customer_phone, customer_email, source, appointment_status, appointment_date, appointment_notes, whatsapp_sent, email_sent, created_at, updated_at)
  → NO deleted_at column
  → appointment_status values: 'pending','contacted','scheduled','converted','rejected'

wa_conversations (id, phone, contact_name, lead_name, lead_email, summary, created_at, updated_at)
  → NO deleted_at column

wa_messages (id, conversation_id, direction, content, created_at)
  → direction: 'inbound' (from customer) or 'outbound' (from bot/agent)
`;

// ─── Role-based system prompts ──────────────────────────────────────────────
function buildSystemPrompt(role: string, userId: string, userName: string): string {
  const base = `אתה עוזר AI חכם של מערכת CRM של "דרך ההייטק" — עסק לחוגי תכנות לילדים.
אתה מקבל שאלות בעברית ומחזיר תשובות בעברית.
יש לך גישה לסכמת ה-DB ואתה יכול לייצר שאילתות SQL.

## כלל חשוב: תמיד תחזיר JSON בפורמט הבא:
{
  "sql": "SELECT ... (או null אם לא צריך SQL)",
  "answer_template": "תבנית התשובה עם {placeholders} לתוצאות ה-SQL",
  "direct_answer": "תשובה ישירה אם לא צריך SQL",
  "needs_sql": true/false
}

## סכמת ה-DB:
${DB_SCHEMA}

## כללי SQL:
- הוסף WHERE deleted_at IS NULL רק לטבלאות שיש להן עמודה זו (ראה בסכמה!)
- תמיד הגבל ב-LIMIT 50 אלא אם מצוין אחרת
- תמיד הוסף ORDER BY created_at DESC לרשימות
- אל תאפשר UPDATE/DELETE/INSERT/DROP — SELECT בלבד!
- אם השאלה דורשת שינוי נתונים — ענה שזה לא מותר דרך הצ'אט
- enum DayOfWeek: ערכים lowercase בלבד: 'sunday','monday','tuesday','wednesday','thursday','friday','saturday'
- בעברית: ראשון=sunday, שני=monday, שלישי=tuesday, רביעי=wednesday, חמישי=thursday
`;

  if (role === 'instructor') {
    return base + `
## הרשאות שלך: מדריך (${userName}, ID: ${userId})
- **מותר:** נתונים שקשורים אליך בלבד
- **אסור:** נתונים של מדריכים אחרים, פיננסים, לידים
- כל שאילתה על meetings/cycles חייבת לכלול: WHERE instructor_id = '${userId}'
- אם שואלים על נתונים של מדריכים אחרים — ענה: "אין לך הרשאה לראות נתונים של מדריכים אחרים"
`;
  }

  if (role === 'sales') {
    return base + `
## הרשאות שלך: מכירות (${userName})
- **מותר:** lead_appointments, wa_conversations, wa_messages, customers (קריאה בלבד)
- **אסור:** פיננסים, ציוני מדריכים, תוכן שיעורים, נתוני רווח
- אם שואלים על נתונים אסורים — ענה: "הנתונים האלה לא נגישים לתפקיד מכירות"
`;
  }

  // manager / admin — full access
  return base + `
## הרשאות שלך: מנהל (${userName})
- גישה מלאה לכל הנתונים
- יכול לשאול על כל טבלה
`;
}

// ─── Run SQL safely ─────────────────────────────────────────────────────────
async function runSQL(sql: string): Promise<any[]> {
  // Safety: only allow SELECT
  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith('SELECT')) {
    throw new Error('Only SELECT queries are allowed');
  }
  // Block dangerous keywords (whole-word match only)
  const dangerous = ['\\bDROP\\b', '\\bDELETE\\b', '\\bUPDATE\\b', '\\bINSERT\\b', '\\bTRUNCATE\\b', '\\bALTER\\b'];
  for (const kw of dangerous) {
    if (new RegExp(kw).test(normalized)) {
      throw new Error(`Query contains forbidden keyword: ${kw.replace(/\\b/g, '')}`);
    }
  }
  return prisma.$queryRawUnsafe(sql);
}

// ─── Format SQL results as readable text ────────────────────────────────────
function formatResults(rows: any[]): string {
  if (!rows || rows.length === 0) return 'לא נמצאו תוצאות.';
  if (rows.length === 1 && Object.keys(rows[0]).length === 1) {
    // Single value (e.g., COUNT)
    const val = Object.values(rows[0])[0];
    return String(val);
  }
  // Table format
  return rows.map((row, i) => {
    const parts = Object.entries(row)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => {
        // Format dates
        if (v instanceof Date) return `${k}: ${v.toLocaleDateString('he-IL')}`;
        return `${k}: ${v}`;
      });
    return `${i + 1}. ${parts.join(' | ')}`;
  }).join('\n');
}

// ─── POST /api/ai-chat ──────────────────────────────────────────────────────
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message required' });
    }

    const user = req.user!;
    const role = user.role || 'instructor';
    const userId = user.userId || '';
    const userName = user.name || user.email || '';

    // For instructors: resolve the actual instructor.id (used in meetings/cycles)
    let instructorDbId = userId;
    if (role === 'instructor') {
      try {
        const instr = await prisma.instructor.findUnique({
          where: { userId },
          select: { id: true }
        });
        if (instr) instructorDbId = instr.id;
      } catch {}
    }

    const systemPrompt = buildSystemPrompt(role, instructorDbId, userName);

    // Build messages history for context
    const chatMessages: any[] = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-6).map((h: any) => ({
        role: h.role,
        content: h.content
      })),
      { role: 'user', content: message }
    ];

    // Step 1: GPT generates SQL + answer template
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: chatMessages,
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const parsed = JSON.parse(completion.choices[0].message.content || '{}');

    let finalAnswer = '';

    if (parsed.needs_sql && parsed.sql) {
      // Step 2: Run the SQL
      let rows: any[];
      try {
        rows = await runSQL(parsed.sql);
      } catch (e: any) {
        console.error('[AI-Chat] SQL error:', e.message, '\nSQL:', parsed.sql);
        return res.json({
          answer: `לא הצלחתי להריץ את השאילתה: ${e.message}`,
          sql: parsed.sql
        });
      }

      const resultsText = formatResults(rows);

      // Step 3: GPT formats the final answer
      const answerCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `תן תשובה בעברית קצרה וברורה בהתבסס על התוצאות. 
אל תחזור על שדות טכניים - תרגם ל-Human Readable.
אם יש מספרים - הצג בצורה ברורה (לדוגמה: "יש 5 שיעורים החודש").`
          },
          { role: 'user', content: `השאלה: ${message}\nתוצאות מה-DB:\n${resultsText}` }
        ],
        max_tokens: 500,
      });

      finalAnswer = answerCompletion.choices[0].message.content || resultsText;
    } else {
      finalAnswer = parsed.direct_answer || 'לא הצלחתי להבין את השאלה. נסה לנסח מחדש.';
    }

    res.json({
      answer: finalAnswer,
      sql: process.env.NODE_ENV === 'development' ? parsed.sql : undefined
    });

  } catch (e: any) {
    console.error('[AI-Chat] Error:', e);
    res.status(500).json({ error: 'שגיאה פנימית', details: e.message });
  }
});

export default router;
