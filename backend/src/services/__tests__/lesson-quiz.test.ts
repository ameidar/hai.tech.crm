import { describe, expect, it } from 'vitest';
import { buildParentQuizMessage, normalizeQuestions } from '../lesson-quiz.js';

describe('normalizeQuestions', () => {
  it('accepts numeric question ids returned by the model', () => {
    const questions = normalizeQuestions([
      {
        id: 1,
        question: 'מה למדנו לעשות בשיעור היום?',
        options: ['לבנות דמות', 'לבנות אתר', 'לשלוח מייל', 'לצייר לוגו'],
        correctIndex: 0,
        explanation: 'בשיעור התמקדנו בבניית דמות.',
      },
      {
        id: 2,
        question: 'איזו פעולה עזרה לנו לבדוק שהקוד עובד?',
        options: ['הרצה ובדיקה', 'מחיקת הפרויקט', 'כיבוי מחשב', 'שינוי שם'],
        correctIndex: 0,
        explanation: 'הרצה ובדיקה מראות אם הקוד עובד.',
      },
      {
        id: 3,
        question: 'מה כדאי לעשות כשמשהו לא מצליח בקוד?',
        options: ['לבדוק שגיאות', 'להתעלם', 'לסגור מיד', 'למחוק הכל'],
        correctIndex: 0,
        explanation: 'בודקים את השגיאה ומתקנים צעד אחרי צעד.',
      },
    ]);

    expect(questions.map((question) => question.id)).toEqual(['1', '2', '3']);
  });

  it('builds a parent-facing WhatsApp message with the quiz link', () => {
    const message = buildParentQuizMessage({
      parentName: 'יערה',
      studentName: 'מורי',
      instructorName: 'ניר',
      cycleName: 'שיעורי ניסיון פרטיים - גנרי',
      url: 'https://crm.orma-ai.com/lesson-quiz/token',
    });

    expect(message).toContain('שלום יערה');
    expect(message).toContain('למורי');
    expect(message).toContain('עם ניר');
    expect(message).toContain('https://crm.orma-ai.com/lesson-quiz/token');
    expect(message).toContain('המדריך יקבל את התשובות והציון');
  });
});
