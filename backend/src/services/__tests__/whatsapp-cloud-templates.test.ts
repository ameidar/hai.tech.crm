import { describe, expect, it } from 'vitest';
import {
  sanitizeWhatsAppTemplateText,
  templateText,
} from '../whatsapp-cloud-templates.js';

describe('WhatsApp Cloud template helpers', () => {
  it('replaces newlines and tabs in template parameters while preserving links', () => {
    const text = [
      '14:30 | Roblox | קישור: https://crm.orma-ai.com/instructor/magic/abc',
      '16:00 | Python | קישור: https://crm.orma-ai.com/instructor/magic/def',
    ].join('\n\t');

    expect(sanitizeWhatsAppTemplateText(text)).toBe(
      '14:30 | Roblox | קישור: https://crm.orma-ai.com/instructor/magic/abc | 16:00 | Python | קישור: https://crm.orma-ai.com/instructor/magic/def',
    );
  });

  it('keeps fallback handling separate from Meta parameter sanitizing', () => {
    expect(templateText('\n', 'אין פירוט שיעורים')).toBe('אין פירוט שיעורים');
    expect(sanitizeWhatsAppTemplateText(' שורה אחת  עם   רווחים ')).toBe('שורה אחת עם רווחים');
  });
});
