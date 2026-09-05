import { sendWhatsApp, MessageResult } from './messaging.js';

export type OperationsWhatsAppRecipient = {
  name: string;
  phone: string;
};

type OperationsRecipient = OperationsWhatsAppRecipient & {
  email: string;
};

const DEFAULT_OPERATIONS_RECIPIENTS: OperationsRecipient[] = [
  { name: 'עמי', phone: '0528746137', email: 'ami@hai.tech' },
  { name: 'קים', phone: '0543354550', email: 'navekim@gmail.com' },
];

function parseOperationsRecipients(raw: string | undefined): OperationsRecipient[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split('|').map((part) => part.trim()))
    .filter(([name, phone, email]) => Boolean(name && phone && email))
    .map(([name, phone, email]) => ({ name, phone, email }));
}

function parseEmailRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
}

function normalizePhoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return `0${digits.slice(3)}`;
  return digits;
}

function getOperationsRecipients(): OperationsRecipient[] {
  const configured = parseOperationsRecipients(process.env.OPERATIONS_RECIPIENTS);
  return configured.length ? configured : DEFAULT_OPERATIONS_RECIPIENTS;
}

export function getOperationsWhatsAppRecipients(extraRecipients: OperationsWhatsAppRecipient[] = []): OperationsWhatsAppRecipient[] {
  const byPhone = new Map<string, OperationsWhatsAppRecipient>();

  for (const recipient of [...getOperationsRecipients(), ...extraRecipients]) {
    const key = normalizePhoneKey(recipient.phone);
    if (key) byPhone.set(key, { name: recipient.name, phone: recipient.phone });
  }

  return Array.from(byPhone.values());
}

export function getOperationsEmailRecipients(fallbackRaw?: string): string[] {
  return Array.from(new Set([
    ...parseEmailRecipients(fallbackRaw),
    ...getOperationsRecipients().map((recipient) => recipient.email),
  ]));
}

export async function sendOperationsWhatsApp(message: string): Promise<MessageResult[]> {
  return Promise.all(
    getOperationsWhatsAppRecipients().map((recipient) =>
      sendWhatsApp({ phone: recipient.phone, message })
    ),
  );
}
