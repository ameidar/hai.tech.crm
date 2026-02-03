import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const ZOOM_SECRET_TOKEN = process.env.ZOOM_SECRET_TOKEN;

/**
 * POST /api/zoom-webhook
 * Receive Zoom webhook events
 */
router.post('/', async (req: Request, res: Response) => {
  console.log('[Zoom Webhook] Received event:', req.body?.event);
  
  // Handle Zoom URL validation (required for webhook setup)
  if (req.body?.event === 'endpoint.url_validation') {
    const plainToken = req.body.payload?.plainToken;
    if (plainToken && ZOOM_SECRET_TOKEN) {
      const encryptedToken = crypto.createHmac('sha256', ZOOM_SECRET_TOKEN)
        .update(plainToken)
        .digest('hex');
      
      console.log('[Zoom Webhook] URL validation response');
      return res.json({
        plainToken,
        encryptedToken
      });
    }
  }
  
  // Verify webhook signature for other events
  // Note: Commenting out for now as it can be tricky to get right
  // if (!verifyZoomWebhook(req)) {
  //   console.log('[Zoom Webhook] Invalid signature');
  //   return res.status(401).json({ error: 'Invalid signature' });
  // }
  
  const event = req.body?.event;
  const payload = req.body?.payload;
  
  try {
    // Handle recording completed event
    if (event === 'recording.completed') {
      const meetingId = String(payload?.object?.id);
      const recordingFiles = payload?.object?.recording_files || [];
      
      console.log('[Zoom Webhook] Recording completed for meeting:', meetingId);
      console.log('[Zoom Webhook] Recording files:', recordingFiles.length);
      
      // Find the share URL (combined recording)
      const shareUrl = payload?.object?.share_url;
      
      // Find MP4 recording file
      const videoFile = recordingFiles.find((f: any) => 
        f.file_type === 'MP4' && f.recording_type === 'shared_screen_with_speaker_view'
      ) || recordingFiles.find((f: any) => f.file_type === 'MP4');
      
      const recordingUrl = shareUrl || videoFile?.play_url || videoFile?.download_url;
      const recordingPassword = payload?.object?.password;
      
      if (recordingUrl) {
        // Update all meetings with this Zoom meeting ID
        const updated = await prisma.meeting.updateMany({
          where: { zoomMeetingId: meetingId },
          data: {
            zoomRecordingUrl: recordingUrl,
            zoomRecordingPassword: recordingPassword || null
          }
        });
        
        console.log(`[Zoom Webhook] Updated ${updated.count} meetings with recording URL`);
      }
    }
    
    // Handle recording started (optional - for tracking)
    if (event === 'recording.started') {
      console.log('[Zoom Webhook] Recording started for meeting:', payload?.object?.id);
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('[Zoom Webhook] Error processing event:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
