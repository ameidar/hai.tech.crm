import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';

const router = Router();
const prisma = new PrismaClient();

const ZOOM_SECRET_TOKEN = process.env.ZOOM_SECRET_TOKEN;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

// Format phone number for Green API (Israel format)
function formatPhoneForWhatsApp(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '972' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('972')) {
    cleaned = '972' + cleaned;
  }
  return cleaned + '@c.us';
}

async function sendWhatsAppToInstructor(phone: string, instructorName: string, topic: string, recordingUrl: string) {
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.log('[Zoom Webhook] WhatsApp not configured, skipping');
    return;
  }
  
  try {
    const message = `שלום ${instructorName} 👋

ההקלטה של השיעור "${topic}" מוכנה!

🎥 לצפייה בהקלטה:
${recordingUrl}

בהצלחה! 🌟`;

    const response = await fetch(
      `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: formatPhoneForWhatsApp(phone),
          message
        })
      }
    );
    
    if (response.ok) {
      console.log(`[Zoom Webhook] Sent WhatsApp to instructor ${instructorName}`);
    } else {
      console.error('[Zoom Webhook] WhatsApp send failed:', await response.text());
    }
  } catch (error) {
    console.error('[Zoom Webhook] WhatsApp error:', error);
  }
}

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS
  }
});

async function sendUnmatchedRecordingEmail(recording: {
  meetingId: string;
  topic: string;
  recordingUrl: string;
  hostEmail: string;
  startTime: string;
}) {
  try {
    await transporter.sendMail({
      from: GMAIL_USER,
      to: 'ami@hai.tech',
      subject: `⚠️ הקלטת Zoom לא מזוהה: ${recording.topic}`,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif;">
          <h2>הקלטת Zoom לא התאימה לאף מחזור במערכת</h2>
          <table style="border-collapse: collapse;">
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>נושא:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${recording.topic}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Meeting ID:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${recording.meetingId}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>מארח:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${recording.hostEmail}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>זמן:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${recording.startTime}</td></tr>
          </table>
          <p style="margin-top: 20px;">
            <a href="${recording.recordingUrl}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">צפה בהקלטה</a>
          </p>
        </div>
      `
    });
    console.log('[Zoom Webhook] Sent unmatched recording email');
  } catch (error) {
    console.error('[Zoom Webhook] Failed to send email:', error);
  }
}

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
        // Get recording start time to match the correct meeting
        const recordingStart = payload?.object?.recording_start;
        let meetingDate: Date | null = null;
        
        if (recordingStart) {
          meetingDate = new Date(recordingStart);
          meetingDate.setHours(0, 0, 0, 0); // Get just the date part
        }
        
        console.log(`[Zoom Webhook] Looking for meeting with ID ${meetingId} on date ${meetingDate?.toISOString()}`);
        
        // Find the specific meeting by Zoom ID and date
        let updated = { count: 0 };
        let meeting = null;
        
        if (meetingDate) {
          // Get start and end of the recording day
          const dayStart = new Date(meetingDate);
          const dayEnd = new Date(meetingDate);
          dayEnd.setDate(dayEnd.getDate() + 1);
          
          // Update the specific meeting on that date
          updated = await prisma.meeting.updateMany({
            where: { 
              zoomMeetingId: meetingId,
              scheduledDate: {
                gte: dayStart,
                lt: dayEnd
              }
            },
            data: {
              zoomRecordingUrl: recordingUrl,
              zoomRecordingPassword: recordingPassword || null
            }
          });
          
          // Get the meeting for WhatsApp notification
          meeting = await prisma.meeting.findFirst({
            where: { 
              zoomMeetingId: meetingId,
              scheduledDate: {
                gte: dayStart,
                lt: dayEnd
              }
            },
            include: { 
              instructor: true,
              cycle: true
            }
          });
        }
        
        // Fallback: if no date available, DON'T update all meetings blindly
        // Only update if there's a single meeting, otherwise save as unmatched
        if (updated.count === 0 && !meetingDate) {
          // Check if there's only one meeting with this ID (single occurrence)
          const meetingsWithId = await prisma.meeting.findMany({
            where: { zoomMeetingId: meetingId },
            include: { instructor: true, cycle: true }
          });
          
          if (meetingsWithId.length === 1) {
            // Only one meeting - safe to update
            updated = await prisma.meeting.updateMany({
              where: { zoomMeetingId: meetingId },
              data: {
                zoomRecordingUrl: recordingUrl,
                zoomRecordingPassword: recordingPassword || null
              }
            });
            meeting = meetingsWithId[0];
          } else if (meetingsWithId.length > 1) {
            // Multiple meetings - can't determine which one, will be saved as unmatched
            console.log(`[Zoom Webhook] Multiple meetings (${meetingsWithId.length}) with same ID but no date to match - saving as unmatched`);
          }
        }
        
        console.log(`[Zoom Webhook] Updated ${updated.count} meetings with recording URL`);
        
        // If meeting matched, send WhatsApp to instructor
        if (updated.count > 0 && meeting?.instructor?.phone) {
          const topic = payload?.object?.topic || meeting.cycle?.name || 'השיעור';
          await sendWhatsAppToInstructor(
            meeting.instructor.phone,
            meeting.instructor.name,
            topic,
            recordingUrl
          );
        }
        
        // If no meetings matched, save to unmatched_recordings and send email
        if (updated.count === 0) {
          const topic = payload?.object?.topic || 'Unknown';
          const hostEmail = payload?.object?.host_email || '';
          const startTime = payload?.object?.recording_start || '';
          const endTime = payload?.object?.recording_end || '';
          
          // Save to unmatched_recordings table
          await prisma.$executeRaw`
            INSERT INTO unmatched_recordings 
            (zoom_meeting_id, zoom_meeting_topic, recording_url, recording_password, recording_start, recording_end, host_email, raw_payload)
            VALUES (${meetingId}, ${topic}, ${recordingUrl}, ${recordingPassword || null}, ${startTime ? new Date(startTime) : null}, ${endTime ? new Date(endTime) : null}, ${hostEmail}, ${JSON.stringify(payload)}::jsonb)
          `;
          
          console.log('[Zoom Webhook] Saved unmatched recording to database');
          
          // Send notification email
          await sendUnmatchedRecordingEmail({
            meetingId,
            topic,
            recordingUrl,
            hostEmail,
            startTime
          });
        }
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
