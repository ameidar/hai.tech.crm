import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { sendWhatsAppMessage } from './notifications.js';

const VAPI_API_BASE = 'https://api.vapi.ai';

// Check if current time in Israel is within business hours (08:00-21:00)
export function isBusinessHoursInIsrael(): boolean {
  const now = new Date();
  const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const hour = israelTime.getHours();
  return hour >= 8 && hour < 21;
}

// Format phone number for Vapi (needs +972 format)
function formatPhoneForVapi(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '972' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

// Build customized first message based on lead data
function buildFirstMessage(data: { name: string; childName?: string; interest?: string }): string {
  const firstName = data.name.split(' ')[0];
  
  if (data.interest === 'kids_education' && data.childName) {
    return `היי ${firstName}, מדברת נועה מדרך ההייטק. ראיתי שנרשמתם לגבי ${data.childName}. אשמח לספר לכם על הקורסים שלנו ולקבוע שיעור ניסיון. יש לכם רגע?`;
  }
  
  if (data.interest === 'ai_business') {
    return `היי ${firstName}, מדברת נועה מדרך ההייטק. ראיתי שהתעניינתם בפתרונות AI לעסקים. אשמח לספר לכם על מה שאנחנו מציעים. יש לכם רגע?`;
  }
  
  return `היי ${firstName}, מדברת נועה מדרך ההייטק. ראיתי שפניתם אלינו דרך האתר. אשמח לעזור לכם. יש לכם רגע?`;
}

// Initiate outbound call via Vapi
export async function initiateVapiCall(data: {
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  childName?: string;
  interest?: string;
  source?: string;
}): Promise<{ leadAppointmentId: string; callId?: string; status: string }> {
  const isDuringBusinessHours = isBusinessHoursInIsrael();
  
  // Create LeadAppointment record
  const leadAppointment = await prisma.leadAppointment.create({
    data: {
      customerId: data.customerId || null,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail || null,
      childName: data.childName || null,
      interest: data.interest || null,
      source: data.source || 'website',
      callStatus: isDuringBusinessHours ? 'queued' : 'pending',
      appointmentStatus: 'pending',
      appointmentNotes: isDuringBusinessHours ? null : 'שיחה תתבצע בשעות הפעילות (08:00-21:00)',
    },
  });

  if (!isDuringBusinessHours) {
    console.log(`[VAPI] Outside business hours, queued for later: ${leadAppointment.id}`);
    return { leadAppointmentId: leadAppointment.id, status: 'pending' };
  }

  if (!config.vapiApiKey) {
    console.error('[VAPI] API key not configured');
    return { leadAppointmentId: leadAppointment.id, status: 'error' };
  }

  try {
    const phoneNumber = formatPhoneForVapi(data.customerPhone);
    const firstMessage = buildFirstMessage({ name: data.customerName, childName: data.childName, interest: data.interest });

    // Build context for the assistant about this specific lead
    // Current date/time in Israel timezone
    const now = new Date();
    const israelFormatter = new Intl.DateTimeFormat('he-IL', {
      timeZone: 'Asia/Jerusalem',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const israelDate = israelFormatter.format(now);
    const isoDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
    const israelTime = now.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });

    const leadContext = [];
    leadContext.push(`היום: ${israelDate} (${isoDate})`);
    leadContext.push(`השעה עכשיו: ${israelTime}`);
    leadContext.push(`שם הלקוח: ${data.customerName}`);
    if (data.childName) leadContext.push(`שם הילד/ה: ${data.childName}`);
    if (data.interest) leadContext.push(`תחום עניין: ${data.interest}`);
    if (data.source) leadContext.push(`מקור הפנייה: ${data.source}`);

    // Fetch the assistant's original system prompt and append lead context + date
    const SYSTEM_PROMPT = `את נועה, נציגה טלפונית של דרך ההייטק.

את מתקשרת לאנשים שהשאירו פרטים באתר. המטרה שלך: להבין מה מעניין אותם ולקבוע פגישה ביומן.

חשוב מאוד - פנייה בלשון הנכונה:
לפי השם של הלקוח, תזהי אם מדובר בגבר או אישה ותפני בהתאם.
שמות נשיים נפוצים: נועה, מיכל, שרה, רחל, אינה, יעל, דנה, טלי, ליאת, אורלי, הילה, שירה, רונית, אורית.
שמות גבריים נפוצים: עמי, דוד, יוסי, אבי, משה, ישראל, חיים, רון, גיל, אלון.
אם לא בטוחה - תפני בלשון נקבה כברירת מחדל.

רקע על דרך ההייטק:
ארגון שמציע חינוך טכנולוגי לילדים ונוער: תכנות, בינה מלאכותית, רובוטיקה, מיינקראפט, רובלוקס. וגם הטמעת בינה מלאכותית בעסקים.

מה לברר בשיחה:
1. מה מעניין אותם
2. שם הילד או הילדה
3. גיל הילד או הילדה
4. האם יש ניסיון קודם בתחום
5. לקבוע פגישה - להשתמש בכלי checkAvailability כדי לבדוק זמינות ואז bookAppointment כדי לקבוע

קביעת פגישה:
אחרי שהבנת מה מעניין אותם, תציעי לקבוע פגישת היכרות. תשאלי באיזה יום נוח להם. אז תבדקי זמינות ביומן עם checkAvailability ותציעי שעות פנויות. אחרי שבחרו שעה, תקבעי עם bookAppointment.
חשוב: כשאת קוראת ל-checkAvailability, השתמשי בפורמט YYYY-MM-DD. התאריך חייב להיות עתידי (היום או אחרי).

איך לדבר:
בקצרה ובטבעיות. כאילו את חברה שמתקשרת. שאלה אחת בכל פעם.

סיום:
אחרי שנקבעה פגישה, סכמי: מעולה, אז קבענו פגישה ביום X בשעה Y. תודה רבה ויום נעים.

כללים:
זו שיחת טלפון. בלי אימוגים, כוכביות, סוגריים או סימנים מיוחדים.
אל תמציאי מידע.
שיחה עד 3 דקות.

=== מידע נוכחי ===
התאריך היום: ${israelDate} (${isoDate})
השעה עכשיו: ${israelTime}
כשמישהו אומר "מחר" הכוונה ליום שאחרי ${isoDate}.

=== פרטי הליד ===
${leadContext.join('\n')}

השתמשי בפרטי הליד בשיחה. אם יש שם ילד/ה ותחום עניין, התייחסי אליהם ישירות ואל תשאלי שאלות שכבר יש לך תשובות עליהן.`;

    const response = await fetch(`${VAPI_API_BASE}/call/phone`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.vapiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistantId: config.vapiAssistantId,
        phoneNumberId: config.vapiPhoneNumberId,
        customer: { number: phoneNumber },
        assistantOverrides: {
          firstMessage,
          model: {
            model: 'gpt-4o',
            provider: 'openai',
            messages: [{ role: 'system', content: SYSTEM_PROMPT }],
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[VAPI] Call initiation failed:', errorText);
      await prisma.leadAppointment.update({
        where: { id: leadAppointment.id },
        data: { callStatus: 'failed', appointmentNotes: `Vapi error: ${errorText}` },
      });
      return { leadAppointmentId: leadAppointment.id, status: 'failed' };
    }

    const result = await response.json() as { id: string };
    console.log('[VAPI] Call initiated:', result.id);

    await prisma.leadAppointment.update({
      where: { id: leadAppointment.id },
      data: { vapiCallId: result.id, callStatus: 'queued' },
    });

    return { leadAppointmentId: leadAppointment.id, callId: result.id, status: 'queued' };
  } catch (error) {
    console.error('[VAPI] Call initiation error:', error);
    await prisma.leadAppointment.update({
      where: { id: leadAppointment.id },
      data: { callStatus: 'failed', appointmentNotes: `Error: ${error}` },
    });
    return { leadAppointmentId: leadAppointment.id, status: 'failed' };
  }
}

// Handle end-of-call-report from Vapi webhook
export async function handleEndOfCallReport(payload: any): Promise<void> {
  const callId = payload.call?.id;
  if (!callId) {
    console.error('[VAPI WEBHOOK] No call ID in payload');
    return;
  }

  // Find the lead appointment by vapi call ID
  const leadAppointment = await prisma.leadAppointment.findFirst({
    where: { vapiCallId: callId },
  });

  if (!leadAppointment) {
    console.error('[VAPI WEBHOOK] No lead appointment found for call:', callId);
    return;
  }

  // Extract data from payload
  const transcript = payload.transcript || null;
  const summary = payload.summary || null;
  const recordingUrl = payload.recordingUrl || payload.artifact?.recordingUrl || payload.call?.recordingUrl || null;
  const structuredData = payload.analysis?.structuredData || null;
  const duration = payload.call?.duration || payload.durationSeconds || null;
  const endedReason = payload.endedReason || payload.call?.endedReason || null;

  // Extract appointment info from structured data
  let appointmentDate: Date | null = null;
  let appointmentTime: string | null = null;
  let appointmentStatus = leadAppointment.appointmentStatus;
  let appointmentNotes = '';

  if (structuredData) {
    if (structuredData.appointmentDate) {
      try {
        appointmentDate = new Date(structuredData.appointmentDate);
        appointmentStatus = 'scheduled';
      } catch (e) {
        console.error('[VAPI WEBHOOK] Failed to parse appointment date:', structuredData.appointmentDate);
      }
    }
    appointmentTime = structuredData.appointmentTime || null;
    if (structuredData.notes) {
      appointmentNotes = structuredData.notes;
    }
    if (structuredData.interested === false) {
      appointmentStatus = 'cancelled';
    }
  }

  // Check if call was not answered
  if (endedReason === 'customer-did-not-answer' || endedReason === 'voicemail') {
    appointmentStatus = 'no_answer';
  }

  // Update the lead appointment
  await prisma.leadAppointment.update({
    where: { id: leadAppointment.id },
    data: {
      callStatus: 'ended',
      callTranscript: transcript,
      callSummary: summary,
      callRecordingUrl: recordingUrl,
      callDuration: duration ? Math.round(duration) : null,
      callEndedReason: endedReason,
      appointmentDate,
      appointmentTime,
      appointmentStatus,
      appointmentNotes: appointmentNotes || null,
      interest: structuredData?.interest || leadAppointment.interest,
      childName: structuredData?.childName || leadAppointment.childName,
    },
  });

  // Build notification message
  const notificationMessage = buildNotificationMessage(leadAppointment, {
    summary,
    structuredData,
    appointmentDate,
    appointmentTime,
    appointmentStatus,
    duration,
  });

  // Send WhatsApp notification to admin
  try {
    const whatsappSent = await sendWhatsAppMessage('972528746137', notificationMessage);
    if (whatsappSent) {
      await prisma.leadAppointment.update({
        where: { id: leadAppointment.id },
        data: { whatsappSent: true },
      });
    }
  } catch (err) {
    console.error('[VAPI WEBHOOK] WhatsApp notification failed:', err);
  }

  // Email notification disabled (2026-02-16) - Ami requested removal
  // WhatsApp notification is sufficient
  console.log(`[VAPI WEBHOOK] Email notification skipped (disabled)`);
  await prisma.leadAppointment.update({
    where: { id: leadAppointment.id },
    data: { emailSent: false },
  });

  console.log(`[VAPI WEBHOOK] Processed end-of-call for appointment ${leadAppointment.id}`);
}

function buildNotificationMessage(
  lead: { customerName: string; customerPhone: string; childName?: string | null; interest?: string | null },
  data: { summary?: string; structuredData?: any; appointmentDate?: Date | null; appointmentTime?: string | null; appointmentStatus: string; duration?: number | null }
): string {
  const lines = [
    `🤖 *סיכום שיחת AI חדשה*`,
    `👤 שם: ${lead.customerName}`,
    `📱 טלפון: ${lead.customerPhone}`,
  ];

  if (lead.childName) lines.push(`👦 ילד/ה: ${lead.childName}`);
  if (lead.interest) lines.push(`🎯 תחום עניין: ${lead.interest}`);
  if (data.duration) lines.push(`⏱ משך שיחה: ${Math.round(data.duration / 60)} דקות`);
  
  lines.push(`📊 סטטוס: ${translateStatus(data.appointmentStatus)}`);
  
  if (data.appointmentDate) {
    lines.push(`📅 תאריך פגישה: ${data.appointmentDate.toLocaleDateString('he-IL')}`);
    if (data.appointmentTime) lines.push(`🕐 שעה: ${data.appointmentTime}`);
  }

  if (data.summary) {
    lines.push('', `📝 סיכום:`, data.summary);
  }

  return lines.join('\n');
}

function translateStatus(status: string): string {
  const map: Record<string, string> = {
    pending: 'ממתין',
    scheduled: 'נקבעה פגישה ✅',
    completed: 'הושלם',
    cancelled: 'בוטל',
    no_answer: 'לא ענה ❌',
  };
  return map[status] || status;
}

// @ts-ignore - kept for potential future use
function _buildEmailHtml(
  lead: { customerName: string; customerPhone: string; childName?: string | null; interest?: string | null },
  data: { summary?: string; structuredData?: any; appointmentDate?: Date | null; appointmentTime?: string | null; appointmentStatus: string; duration?: number | null }
): string {
  return `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>🤖 סיכום שיחת AI - ${lead.customerName}</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>שם:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${lead.customerName}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>טלפון:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${lead.customerPhone}</td></tr>
        ${lead.childName ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>ילד/ה:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${lead.childName}</td></tr>` : ''}
        ${lead.interest ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>תחום עניין:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${lead.interest}</td></tr>` : ''}
        ${data.duration ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>משך שיחה:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${Math.round(data.duration / 60)} דקות</td></tr>` : ''}
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>סטטוס:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${translateStatus(data.appointmentStatus)}</td></tr>
        ${data.appointmentDate ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>תאריך פגישה:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.appointmentDate.toLocaleDateString('he-IL')}${data.appointmentTime ? ` ${data.appointmentTime}` : ''}</td></tr>` : ''}
      </table>
      ${data.summary ? `<h3>סיכום השיחה:</h3><p style="background: #f5f5f5; padding: 12px; border-radius: 8px;">${data.summary}</p>` : ''}
    </div>
  `;
}
