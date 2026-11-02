import { describe, it, expect } from 'vitest';
import { detectHandoffPromise, buildCallbackGroupAlert } from '../wa-handoff-promise.js';

describe('detectHandoffPromise', () => {
  // Real bot replies from prod (Oct–Nov 2026) that promised a handoff with no callback created.
  it.each([
    'תודה יאיר! רשמתי את המייל שלך (yair@example.com) ואעביר את הבקשה לנציג שישלח לך דוגמאות.',
    'מעולה, נקבע לנו ראשון 10:30 💙\nאעביר את זה לעמי לתיאום סופי מולך, והוא יחזור אלייך לאישור',
    'תודה, עינב! אני אעביר את הפרטים לנציג אנושי שיבדוק את הנושא ויחזור אליך בהקדם. 😊',
    'אני מבין, זה באמת חשוב. אני אעביר את הבקשה לנציג אנושי שיבדוק את הנושא. האם תוכל/י למסור את המייל?',
    'תודה שעדכנתם! קים, הרכז שלנו, יחזור אליכם לתאם מועד אחר. 💜',
    'שאלה מצוינת! אני בודק ונציג יחזור אליך עם תשובה מדויקת',
    'אני מבין/ה, זה באמת מתסכל.\nאני מעביר/ה את זה לנציג אנושי לבדיקה לפי הפרטים ששלחת. יחזרו אליך כאן בהקדם 🙏',
  ])('detects promise: %s', (reply) => {
    expect(detectHandoffPromise(reply)).toBe(true);
  });

  it.each([
    'רוצה שנציג יחזור אליך בהקדם ויעזור להתאים מסלול?',
    'אשמח לעזור! מה השאלה שלך? אם צריך, אוכל להעביר אותה לנציג אנושי להמשך טיפול. 😊',
    'העלות לחוגים בעומר היא 2,980 ש״ח לשנה עבור 32 מפגשים.',
    'הקורס נפגש פעמיים בשבוע, ותלמידים חוזרים אליו שוב ושוב.',
    'אין לנו כרגע קורס ב-C++. השפות שאנחנו מלמדים הן JavaScript ו-Python.',
    '',
  ])('ignores non-promise: %s', (reply) => {
    expect(detectHandoffPromise(reply)).toBe(false);
  });

  it('handles null/undefined', () => {
    expect(detectHandoffPromise(null)).toBe(false);
    expect(detectHandoffPromise(undefined)).toBe(false);
  });
});

describe('buildCallbackGroupAlert', () => {
  it('includes customer, phone, both texts and link for bot promises', () => {
    const msg = buildCallbackGroupAlert({
      contactName: 'יאיר',
      phone: '972545697337',
      customerText: 'אפשר דוגמאות?',
      botReply: 'אעביר לנציג',
      link: 'https://crm.orma-ai.com/whatsapp?conv=abc',
      reason: 'bot_promise',
    });
    expect(msg).toContain('הבוט הבטיח');
    expect(msg).toContain('יאיר');
    expect(msg).toContain('972545697337');
    expect(msg).toContain('אפשר דוגמאות?');
    expect(msg).toContain('אעביר לנציג');
    expect(msg).toContain('conv=abc');
  });

  it('omits bot line for customer requests and clips long text', () => {
    const msg = buildCallbackGroupAlert({
      phone: '972500000000',
      customerText: 'א'.repeat(500),
      link: 'x',
      reason: 'customer_request',
    });
    expect(msg).toContain('לקוח ביקש');
    expect(msg).not.toContain('הבוט ענה');
    expect(msg).toContain('…');
  });
});
