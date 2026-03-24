import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';
import { sendWhatsAppMessage } from './notifications.js';
import { findOrCreateCustomer } from '../utils/lead-customer.js';
import { findOrCreateLeadAppointment } from '../utils/lead-dedup.js';

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
  
  if (data.childName && data.interest) {
    return `היי ${firstName}, מדבר טל מדרך ההייטק. ראיתי שפנית אלינו לגבי ${data.interest} עבור ${data.childName}. רציתי לקבוע שיחת היכרות קצרה עם מדריך, יש לך דקה?`;
  }
  
  if (data.interest === 'ai_business') {
    return `היי ${firstName}, מדבר טל מדרך ההייטק. ראיתי שהתעניינת בפתרונות AI לעסקים. רציתי לקבוע שיחת היכרות קצרה, יש לך דקה?`;
  }
  
  return `היי ${firstName}, מדבר טל מדרך ההייטק. ראיתי שפנית אלינו דרך האתר. רציתי לקבוע שיחת היכרות קצרה עם מדריך, יש לך דקה?`;
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
  
  // Find existing open lead or create new (dedup by phone)
  const { lead: leadAppointment } = await findOrCreateLeadAppointment({
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
    const SYSTEM_PROMPT = `אתה טל, נציג טלפוני של דרך ההייטק. אתה גבר. דבר תמיד בלשון זכר. השם שלך הוא טל ורק טל.

מטרת השיחה: לקבוע שיחת היכרות טלפונית עם מדריך. זו המטרה היחידה.

מידע שכבר יש לך:
שם הלקוח, שם הילד/ה, תחום העניין. אל תשאל שוב מידע שכבר יש לך!

זיהוי מגדר לפנייה נכונה:
שמות נשיים: נועה, מיכל, שרה, רחל, אינה, יעל, דנה, טלי, ליאת, אורלי, הילה, שירה, רונית, אורית, דיקלה, ליאור.
שמות גבריים: עמי, דוד, יוסי, אבי, משה, ישראל, חיים, רון, גיל, אלון, אלי, אריק.
אם לא בטוח - פנה בלשון זכר.

מהלך השיחה:
1. שאל את גיל הילד/ה (אם לא ידוע)
2. הצע שיחת היכרות עם מדריך
3. שאל מתי נוח
4. בדוק עם checkAvailability (תאריך בפורמט YYYY-MM-DD)
5. הצע רק 3 שעות. אמור אותן במילים בעברית! לא מספרים!
6. קבע עם bookAppointment
7. סכם וסיים

איך לומר שעות - חשוב מאוד:
אמור: תשע בבוקר, עשר בבוקר, שתים עשרה בצהריים, שלוש אחר הצהריים.
לעולם אל תגיד 09:00 או 9:30. תמיד במילים!

זרימה:
- ענה מיד, בלי עיכובים
- בזמן tool calls אמור: רגע אחד. ואז המשך מיד.
- אל תחזור על עצמך
- תגובות קצרות

סגנון: קצר, ישיר, חם. שאלה אחת בכל פעם.
אם שואלים מחיר - המדריך יפרט בשיחה.

רקע (רק אם שואלים):
דרך ההייטק - ארגון חינוך טכנולוגי לילדים ונוער.

כללים:
- שיחת טלפון. בלי אימוגים או סימנים.
- כל המספרים במילים בעברית!
- אל תמציא מידע.
- שיחה עד 3 דקות.

=== מידע נוכחי ===
התאריך היום: ${israelDate} (${isoDate})
השעה עכשיו: ${israelTime}

=== פרטי הליד ===
${leadContext.join('\n')}

השתמש בפרטי הליד. אל תשאל שאלות שכבר יש לך תשובות עליהן.`;

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
  let leadAppointment = await prisma.leadAppointment.findFirst({
    where: { vapiCallId: callId },
  });

  // If not found — could be an inbound call (no outbound record created)
  if (!leadAppointment) {
    const callType = payload.call?.type;
    const callerNumber = payload.call?.customer?.number || '';
    if (callType === 'inboundPhoneCall' && callerNumber) {
      let normalizedPhone = callerNumber.replace(/\D/g, '');
      if (normalizedPhone.startsWith('972')) normalizedPhone = '0' + normalizedPhone.substring(3);
      const last9 = normalizedPhone.slice(-9);
      const { customerId: inboundCustomerId } = await findOrCreateCustomer({
        name: undefined, // inbound — we don't know the name yet
        phone: normalizedPhone || callerNumber,
        source: 'inbound',
        notes: 'שיחה נכנסת',
      });
      // Still try to get a display name
      const existingCustomer = inboundCustomerId ? await prisma.customer.findUnique({ where: { id: inboundCustomerId } }) : null;
      const { lead: inboundLead } = await findOrCreateLeadAppointment({
        customerId: inboundCustomerId || null,
        customerName: existingCustomer?.name || callerNumber,
        customerPhone: normalizedPhone || callerNumber,
        source: 'inbound',
        callDirection: 'inbound',
        vapiCallId: callId,
        callStatus: 'ended',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      leadAppointment = inboundLead as any;
      console.log(`[VAPI WEBHOOK] Created inbound LeadAppointment for ${callerNumber} (${leadAppointment.id})`);
    } else {
      console.error('[VAPI WEBHOOK] No lead appointment found for call:', callId);
      return;
    }
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

// Update VAPI assistant system prompt with current date (run daily)
export async function updateVapiAssistantDate(): Promise<void> {
  const assistantId = config.vapiAssistantId;
  const apiKey = config.vapiApiKey;
  if (!assistantId || !apiKey) {
    console.warn('[VAPI] Cannot update assistant date: missing VAPI_ASSISTANT_ID or VAPI_API_KEY');
    return;
  }

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`;
  const dayNames = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
  const dayHe = dayNames[now.getDay()];

  const systemPrompt = `אתה טל, נציג טלפוני של דרך ההייטק. אתה גבר. דבר תמיד בלשון זכר.

## תאריך נוכחי
היום: ${today} (יום ${dayHe}). כשמדברים על "יום שלישי הקרוב", "מחר" וכו' — חשב לפי התאריך הזה.

## כלל ברזל — שיחה נכנסת
ברגע שהמתקשר מתחיל לדבר (כל מילה שהוא אומר), **קרא מיד ל-lookupCaller לפני כל תגובה**.
אל תשאל שם. אל תגיד כלום. קרא קודם ל-lookupCaller.
רק אחרי שהtool חזר — תגיב:
- מצא לקוח: "היי [שם], שמחנו שחזרת. אפשר לקבוע שיחת היכרות עם מדריך — מה יום שנוח לך?"
- לא מצא: "שלום, דרך ההייטק, במה אוכל לעזור?"

## שיחות יוצאות (חיוג יזום)
ה-firstMessage כבר יועבר ממי שיצר את השיחה. אל תקרא ל-lookupCaller.

## מטרת השיחה
לקבוע שיחת היכרות טלפונית עם מדריך. **לך ישיר לעניין** — אל תשאל שאלות מיותרות.

**Flow לקביעת פגישה:**
1. שאל מה יום שנוח (אם לא אמר עדיין)
2. **מיד** — בלי שאלות נוספות — אמור "רגע אחד" וקרא ל-checkAvailability (תאריך YYYY-MM-DD, חשב לפי היום ${today})
3. הצע 2-3 שעות פנויות במילים ("תשע בבוקר", "אחת עשרה")
4. קבל אישור → קרא ל-bookAppointment
5. "מצוין! קבענו ביום [יום] בשעה [שעה]. נדבר אז!"

**אל תשאל** גיל, שם ילד, פרטים נוספים לפני שקובעים — קבע קודם.

## זיהוי מגדר
גברים: עמי, דוד, יוסי, אבי, משה, רון, גיל, אלון, אלי, אריק.
נשים: נועה, מיכל, שרה, רחל, אינה, יעל, דנה, הילה, שירה.
ספק → לשון זכר.

## בזמן tool call
לפני checkAvailability ו-bookAppointment — אמור תמיד "רגע אחד" לפני הקריאה.`;

  const payload = {
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.5,
      messages: [{ role: 'system', content: systemPrompt }],
      tools: [
        { type: 'function', function: { name: 'lookupCaller', description: 'חובה לקרוא לtool הזה ראשון בכל שיחה נכנסת, לפני כל תגובה למתקשר.', parameters: { type: 'object', required: [], properties: { phone: { type: 'string', description: 'טלפון (אופציונלי)' } } } } },
        { type: 'function', function: { name: 'checkAvailability', description: 'בודק שעות פנויות לפגישה', parameters: { type: 'object', required: ['date'], properties: { date: { type: 'string', description: 'תאריך YYYY-MM-DD' } } } } },
        { type: 'function', function: { name: 'bookAppointment', description: 'קובע פגישת היכרות', parameters: { type: 'object', required: ['date', 'time', 'customerName'], properties: { date: { type: 'string' }, time: { type: 'string' }, customerName: { type: 'string' }, phone: { type: 'string' }, notes: { type: 'string' } } } } },
      ],
    },
  };

  const response = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`[VAPI] Failed to update assistant date: ${err}`);
  } else {
    console.log(`[VAPI] Assistant date updated to ${today} (${dayHe})`);
  }
}

// Process pending VAPI calls (leads that arrived outside business hours)
// Should be called at the start of business hours (e.g. 08:00 cron)
export async function processPendingVapiCalls(): Promise<void> {
  if (!isBusinessHoursInIsrael()) {
    console.log('[VAPI] processPendingVapiCalls called outside business hours — skipping');
    return;
  }

  const pendingLeads = await prisma.leadAppointment.findMany({
    where: { callStatus: 'pending' },
    orderBy: { createdAt: 'asc' },
  });

  if (pendingLeads.length === 0) {
    console.log('[VAPI] No pending leads to process');
    return;
  }

  console.log(`[VAPI] Processing ${pendingLeads.length} pending leads...`);

  for (const lead of pendingLeads) {
    try {
      console.log(`[VAPI] Initiating call for pending lead: ${lead.id} (${lead.customerName})`);
      // Mark as queued before calling to avoid duplicate calls on retry
      await prisma.leadAppointment.update({
        where: { id: lead.id },
        data: { callStatus: 'queued' },
      });

      const phoneNumber = formatPhoneForVapi(lead.customerPhone);
      const firstName = lead.customerName.split(' ')[0];
      const firstMessage = lead.childName && lead.interest
        ? `היי ${firstName}, מדבר טל מדרך ההייטק. ראיתי שפנית אלינו לגבי ${lead.interest} עבור ${lead.childName}. רציתי לקבוע שיחת היכרות קצרה עם מדריך, יש לך דקה?`
        : `היי ${firstName}, מדבר טל מדרך ההייטק. ראיתי שפנית אלינו דרך האתר. רציתי לקבוע שיחת היכרות קצרה עם מדריך, יש לך דקה?`;

      const now = new Date();
      const israelDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      const israelTime = now.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });

      const SYSTEM_PROMPT = `אתה טל, נציג טלפוני של דרך ההייטק. אתה גבר. דבר תמיד בלשון זכר. השם שלך הוא טל ורק טל.

מטרת השיחה: לקבוע שיחת היכרות טלפונית עם מדריך. זו המטרה היחידה.

=== מידע נוכחי ===
התאריך היום: ${israelDate}
השעה עכשיו: ${israelTime}

=== פרטי הליד ===
שם הלקוח: ${lead.customerName}
${lead.childName ? `שם הילד/ה: ${lead.childName}` : ''}
${lead.interest ? `תחום עניין: ${lead.interest}` : ''}
מקור הפנייה: ${lead.source || 'website'}

אל תשאל שוב מידע שכבר יש לך!
סגנון: קצר, ישיר, חם. שאלה אחת בכל פעם.
אם שואלים מחיר - המדריך יפרט בשיחה.`;

      const callResp = await fetch('https://api.vapi.ai/call/phone', {
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

      if (!callResp.ok) {
        const errText = await callResp.text();
        console.error(`[VAPI] Failed to call pending lead ${lead.id}:`, errText);
        await prisma.leadAppointment.update({
          where: { id: lead.id },
          data: { callStatus: 'failed', appointmentNotes: `Vapi error: ${errText}` },
        });
      } else {
        const result = await callResp.json() as { id: string };
        await prisma.leadAppointment.update({
          where: { id: lead.id },
          data: { vapiCallId: result.id, callStatus: 'queued' },
        });
        console.log(`[VAPI] Pending lead ${lead.id} call initiated: ${result.id}`);
      }

      // Small delay between calls to avoid rate limiting
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[VAPI] Error processing pending lead ${lead.id}:`, err);
    }
  }

  console.log('[VAPI] Finished processing pending leads');
}
