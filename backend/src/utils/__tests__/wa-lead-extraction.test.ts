import { describe, expect, it } from 'vitest';
import {
  extractInboundEmails,
  sanitizeLeadEmail,
  shouldSendPromisedEmailAlert,
} from '../wa-lead-extraction.js';

describe('WhatsApp lead extraction guards', () => {
  it('does not treat HaiTech outbound email as a customer email', () => {
    const messages = [
      {
        direction: 'inbound',
        content: 'היי, יש לכם כרגע משרות פנויות למדריכים? אשמח לשלוח קורות חיים',
      },
      {
        direction: 'outbound',
        content: 'היי, נשמח לקבל קורות חיים ל info@hai.tech',
      },
    ];

    expect(extractInboundEmails(messages)).toEqual(new Set());
    expect(sanitizeLeadEmail('info@hai.tech', messages)).toBeNull();
    expect(shouldSendPromisedEmailAlert(true, sanitizeLeadEmail('info@hai.tech', messages))).toBe(false);
  });

  it('accepts an external email only when the customer sent it inbound', () => {
    const messages = [
      {
        direction: 'inbound',
        content: 'אפשר לשלוח לי פרטים למייל keren@example.com?',
      },
      {
        direction: 'outbound',
        content: 'בשמחה, נשלח לך פרטים',
      },
    ];

    expect(sanitizeLeadEmail('keren@example.com', messages)).toBe('keren@example.com');
    expect(shouldSendPromisedEmailAlert(true, sanitizeLeadEmail('keren@example.com', messages))).toBe(true);
  });
});
