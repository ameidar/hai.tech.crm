type ConversationMessage = {
  direction: 'inbound' | 'outbound' | string;
  content: string | null;
};

const HAI_TECH_EMAILS = new Set([
  'info@hai.tech',
  'inna@hai.tech',
  'hila@hai.tech',
  'ami@hai.tech',
]);

export function normalizeEmail(value?: string | null): string | null {
  const email = (value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function isHaiTechEmail(value?: string | null): boolean {
  const email = normalizeEmail(value);
  if (!email) return false;
  return email.endsWith('@hai.tech') || HAI_TECH_EMAILS.has(email);
}

export function extractInboundEmails(messages: ConversationMessage[]): Set<string> {
  const emails = new Set<string>();
  for (const message of messages) {
    if (message.direction !== 'inbound') continue;
    const matches = (message.content || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    for (const match of matches) {
      const email = normalizeEmail(match);
      if (email && !isHaiTechEmail(email)) emails.add(email);
    }
  }
  return emails;
}

export function sanitizeLeadEmail(
  extractedEmail: string | null | undefined,
  messages: ConversationMessage[]
): string | null {
  const email = normalizeEmail(extractedEmail);
  if (!email || isHaiTechEmail(email)) return null;
  return extractInboundEmails(messages).has(email) ? email : null;
}

export function shouldSendPromisedEmailAlert(
  emailPromised: unknown,
  sanitizedLeadEmail: string | null
): boolean {
  return Boolean(emailPromised && sanitizedLeadEmail);
}
