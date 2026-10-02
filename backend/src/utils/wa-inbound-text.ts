// Normalizes an inbound WhatsApp Cloud message to the text we store.
// Text → body; template quick-reply → button text; interactive reply → title; anything else → null (skip).
export function extractInboundText(msg: any): string | null {
  if (msg?.type === 'text') return msg.text?.body || '';
  if (msg?.type === 'button') return msg.button?.text || msg.button?.payload || null;
  if (msg?.type === 'interactive') {
    return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || null;
  }
  return null;
}
