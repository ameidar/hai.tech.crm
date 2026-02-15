import { Router, Request, Response } from 'express';
import { handleEndOfCallReport } from '../services/vapi.js';

export const vapiWebhookRouter = Router();

// POST /api/vapi-webhook
// No auth - Vapi sends webhooks without API key
vapiWebhookRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    const messageType = message?.type || req.body.type;
    
    console.log('[VAPI WEBHOOK] Received event:', messageType);

    switch (messageType) {
      case 'end-of-call-report':
        // Process async so we respond quickly
        handleEndOfCallReport(message || req.body).catch(err => {
          console.error('[VAPI WEBHOOK] Error processing end-of-call-report:', err);
        });
        break;

      case 'status-update':
        // Log status changes
        const callId = message?.call?.id || req.body.call?.id;
        const status = message?.status || req.body.status;
        console.log(`[VAPI WEBHOOK] Call ${callId} status: ${status}`);
        break;

      case 'hang':
      case 'function-call':
      case 'speech-update':
      case 'transcript':
        // Acknowledged but not processed
        break;

      default:
        console.log('[VAPI WEBHOOK] Unhandled event type:', messageType);
    }

    // Always respond 200 quickly
    res.json({ success: true });
  } catch (error) {
    console.error('[VAPI WEBHOOK] Error:', error);
    res.json({ success: true }); // Still respond 200 to avoid retries
  }
});
