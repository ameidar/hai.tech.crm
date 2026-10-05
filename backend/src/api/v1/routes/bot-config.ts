import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireScopeOrRole } from '../middleware/scope-check.js';
import { validateBody } from '../middleware/validate.js';
import { updateBotConfigSchema } from '../validators/ops.js';
import { sendSuccess } from '../../../common/utils/response.js';
import {
  getBotConfig,
  getBotConfigStatus,
  updateBotConfig,
} from '../../../services/wa-bot-config.js';

/**
 * WhatsApp bot configuration — v1 ops API.
 * Reads/writes the SAME in-memory state the live bot uses (services/wa-bot-config.ts), so a
 * PUT takes effect on the next bot reply without a restart.
 *
 * Scopes read:bot_config / write:bot_config are explicit-only: never implied by '*',
 * 'read:*' or 'write:*'.
 */
const router = Router();

router.use(authenticate);

const ROLES = ['admin', 'manager'] as const; // internal /api/wa/bot-config: admin|manager

/** GET /bot-config — current system prompt + raw knowledge base + load status. */
router.get('/', requireScopeOrRole('read:bot_config', ROLES), (_req, res) => {
  sendSuccess(res, { ...getBotConfig(), status: getBotConfigStatus() });
});

/**
 * GET /bot-config/status — whether the live knowledge base parsed successfully and which
 * source (db/file) the bot is actually using. No prompt/KB text in the response.
 */
router.get('/status', requireScopeOrRole('read:bot_config', ROLES), (_req, res) => {
  sendSuccess(res, getBotConfigStatus());
});

/**
 * PUT /bot-config — update systemPrompt and/or knowledgeBase. An invalid JSON knowledge base
 * is rejected with 400 and nothing is written.
 */
router.put('/', requireScopeOrRole('write:bot_config', ROLES), validateBody(updateBotConfigSchema), async (req, res, next) => {
  try {
    const { changed } = await updateBotConfig(req.body, req);
    sendSuccess(res, { changed, status: getBotConfigStatus() });
  } catch (error) {
    next(error);
  }
});

export { router as botConfigRouter };
