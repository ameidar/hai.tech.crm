// Auto-responder for the 053-320-7515 WhatsApp number.
//
// When a chat sends a message that isn't a recognized poll/yes-no reply, send
// a canned "I'm a bot, contact this other number for a human" message. Reply
// once per chatId — subsequent messages from the same chat are silent so the
// bot doesn't spam. State is persisted to a flat JSON file outside the CRM
// database (Ami's explicit ask: keep this logic standalone, no CRM data).

import fs from 'fs';
import path from 'path';
import { sendWhatsAppToChat } from './messaging.js';

const STATE_FILE = path.join(process.cwd(), 'data', 'whatsapp-auto-bot-state.json');

const CANNED_REPLY =
  'שלום, הגעת לדרך ההייטק.\n' +
  'אני בוט.\n' +
  'אם ברצונך לקבל מענה צור קשר במספר 053-300-9742';

interface State {
  replied: Record<string, string>; // chatId -> ISO timestamp of first reply
}

function loadState(): State {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.replied) return parsed as State;
  } catch {
    // file missing / unreadable — start fresh
  }
  return { replied: {} };
}

function saveState(state: State): void {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  // Atomic-ish write — avoid a half-written file if we crash mid-write.
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

export function hasAutoReplied(chatId: string): boolean {
  const state = loadState();
  return Boolean(state.replied[chatId]);
}

/**
 * Send the canned reply if we haven't already replied to this chatId.
 * Returns true if a reply was sent on this call.
 */
export async function maybeAutoReply(chatId: string): Promise<boolean> {
  const state = loadState();
  if (state.replied[chatId]) return false;

  const result = await sendWhatsAppToChat(chatId, CANNED_REPLY);
  if (!result.success) {
    console.error(`[wa-auto-bot] send failed to ${chatId}: ${result.error}`);
    return false;
  }

  state.replied[chatId] = new Date().toISOString();
  saveState(state);
  console.log(`[wa-auto-bot] auto-replied to ${chatId} (messageId=${result.messageId})`);
  return true;
}
