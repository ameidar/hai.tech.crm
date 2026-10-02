import { describe, expect, it, vi } from 'vitest';
vi.mock('../../utils/prisma.js', () => ({ prisma: {} }));
describe('extractInboundText', async () => {
  const { extractInboundText } = await import('../whatsapp.js');
  it('reads plain text', () => expect(extractInboundText({ type: 'text', text: { body: 'שלום' } })).toBe('שלום'));
  it('reads template quick-reply button', () => expect(extractInboundText({ type: 'button', button: { text: 'מגיעים ✅', payload: 'yes' } })).toBe('מגיעים ✅'));
  it('reads interactive button reply', () => expect(extractInboundText({ type: 'interactive', interactive: { button_reply: { id: 'x', title: 'לא נוכל להגיע' } } })).toBe('לא נוכל להגיע'));
  it('ignores media', () => expect(extractInboundText({ type: 'image' })).toBeNull());
});
