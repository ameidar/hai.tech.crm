// Detects bot replies that promise to hand the conversation to a human
// ("אעביר לנציג", "נציג יחזור אליך"...). The LLM makes these promises on its own,
// so the webhook uses this to open a real callback request instead of an empty promise.
//
// Offers phrased as questions ("רוצה שנציג יחזור אליך?") or as possibilities
// ("אוכל להעביר לנציג") are not promises and must not trigger.

const PROMISE_PATTERNS: RegExp[] = [
  // first-person forwarding: אעביר / נעביר / אני מעביר/ה / מעבירה את
  /(^|[\s,.!(])ו?(אעביר|נעביר|אני מעביר|מעביר\/ה את|מעבירה את|מעביר את)/,
  // "I'll check and a representative will get back to you"
  /(^|[\s,.!("])ו?(נציג|הצוות|מישהו מהצוות|הרכז|הרכזת|קים|עמי|אינה|הילה)[^.!?\n]{0,30}(יחזור|יחזרו|תחזור|יצרו קשר|ייצור קשר|יתקשר|יתקשרו|יעדכן|יעדכנו)\s*(אליך|אלייך|אליכם|אלייכם|איתך|אותך)/,
  /(יחזרו|יחזור|ייצרו קשר|יצרו קשר)\s*(אליך|אלייך|אליכם|אלייכם)\s*(בהקדם|בקרוב|עם)/,
];

// Sentence-level phrases that turn a match into an offer rather than a commitment.
const OFFER_PATTERN = /(רוצה ש|רוצים ש|תרצה ש|תרצי ש|תרצו ש|אשמח ש|אוכל ל|אפשר ל|נוכל ל|אם תרצ|אם צריך|אם תצטרך|האם)/;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function detectHandoffPromise(replyText: string | null | undefined): boolean {
  if (!replyText) return false;
  return splitSentences(String(replyText)).some((sentence) => {
    if (sentence.endsWith('?')) return false;
    if (OFFER_PATTERN.test(sentence)) return false;
    return PROMISE_PATTERNS.some((re) => re.test(sentence));
  });
}

export function buildCallbackGroupAlert(params: {
  contactName?: string | null;
  phone: string;
  customerText: string;
  botReply?: string | null;
  link: string;
  reason: 'customer_request' | 'escalation' | 'bot_promise';
}): string {
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
  const title =
    params.reason === 'bot_promise'
      ? '📞 הבוט הבטיח ללקוח שנחזור אליו'
      : params.reason === 'escalation'
        ? '📞 הבוט העביר שיחה לנציג'
        : '📞 לקוח ביקש שנחזור אליו';
  const lines = [
    title,
    '',
    `לקוח: ${params.contactName || '—'}`,
    `טלפון: ${params.phone}`,
    `הלקוח כתב: "${clip(params.customerText, 300)}"`,
  ];
  if (params.botReply) lines.push(`הבוט ענה: "${clip(params.botReply, 300)}"`);
  lines.push('', `🔗 ${params.link}`);
  return lines.join('\n');
}
