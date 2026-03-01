import { Router, Request, Response } from 'express';
import { getAvailableSlots, bookAppointment } from '../services/google-calendar.js';
import { prisma } from '../utils/prisma.js';
import { handleEndOfCallReport } from '../services/vapi.js';
export const vapiToolsRouter = Router();

// In-memory cache: callId → appointment data (bridging bookAppointment tool call → end-of-call-report)
const pendingAppointments = new Map<string, { date: string; time: string; notes: string }>();

// Single endpoint that handles all Vapi tool calls AND end-of-call webhooks
vapiToolsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    const messageType = message?.type || req.body.type;

    // Handle end-of-call-report (same serverUrl for tools + webhooks in VAPI)
    if (messageType === 'end-of-call-report') {
      console.log('[VAPI TOOLS] Received end-of-call-report, delegating to handler');
      const eocCallId = message?.call?.id || req.body?.call?.id;
      handleEndOfCallReport(message || req.body).then(async () => {
        // Apply cached appointment data (from bookAppointment tool during the call)
        if (eocCallId && pendingAppointments.has(eocCallId)) {
          const appt = pendingAppointments.get(eocCallId)!;
          pendingAppointments.delete(eocCallId);
          try {
            const rows = await prisma.$executeRaw`
              UPDATE lead_appointments
              SET appointment_date = ${new Date(appt.date)}::timestamp,
                  appointment_time = ${appt.time},
                  appointment_status = 'scheduled',
                  appointment_notes = ${appt.notes || 'נקבע ע"י טל (AI)'},
                  updated_at = NOW()
              WHERE vapi_call_id = ${eocCallId}
            `;
            console.log(`[VAPI TOOLS] Applied cached appointment for call ${eocCallId}: ${appt.date} ${appt.time} (rows: ${rows})`);
          } catch (err: any) {
            console.error('[VAPI TOOLS] Failed to apply cached appointment:', err.message);
          }
        }
      }).catch((err: any) => {
        console.error('[VAPI TOOLS] Error processing end-of-call-report:', err);
      });
      return res.json({ success: true });
    }

    // Handle call-start — lookup caller and return dynamic firstMessage
    if (messageType === 'call-start') {
      const callType = message?.call?.type;
      const callerNumber = message?.call?.customer?.number || '';
      console.log(`[VAPI TOOLS] call-start: type=${callType}, from=${callerNumber}`);

      if (callType === 'inboundPhoneCall' && callerNumber) {
        let normalized = callerNumber.replace(/\D/g, '');
        if (normalized.startsWith('972')) normalized = '0' + normalized.substring(3);
        const last9 = normalized.slice(-9);

        const customer = last9 ? await prisma.customer.findFirst({
          where: { phone: { contains: last9 } },
          include: { students: { select: { name: true } } },
        }) : null;

        const lastLead = last9 ? await prisma.leadAppointment.findFirst({
          where: { customerPhone: { contains: last9 } },
          orderBy: { createdAt: 'desc' },
        }) : null;

        let firstName = '';
        let context = '';

        if (customer) {
          firstName = customer.name.split(' ')[0];
          if (lastLead?.interest) context = ` בנושא ${lastLead.interest}`;
          else if (lastLead?.childName) context = ` לגבי ${lastLead.childName}`;
          console.log(`[VAPI TOOLS] call-start lookup: found customer ${customer.name} (${callerNumber})`);
        } else if (lastLead) {
          firstName = lastLead.customerName.split(' ')[0];
          if (lastLead.interest) context = ` בנושא ${lastLead.interest}`;
          console.log(`[VAPI TOOLS] call-start lookup: found lead ${lastLead.customerName} (${callerNumber})`);
        }

        if (firstName) {
          const firstMessage = `היי ${firstName}, מדבר טל מדרך ההייטק${context}. איך אוכל לעזור?`;
          console.log(`[VAPI TOOLS] call-start returning firstMessage: ${firstMessage}`);
          return res.json({
            messageResponse: {
              assistant: { firstMessage }
            }
          });
        }
      }

      // Unknown caller or outbound — use default greeting
      return res.json({
        messageResponse: {
          assistant: { firstMessage: 'שלום, דרך ההייטק, במה אוכל לעזור?' }
        }
      });
    }

    // Handle status-update silently
    if (messageType === 'status-update') {
      const callId = message?.call?.id;
      const status = message?.status;
      console.log(`[VAPI TOOLS] Call ${callId} status: ${status}`);
      return res.json({ success: true });
    }

    const toolCallList = message?.toolCallList || [];
    
    console.log('[VAPI TOOLS] Received tool calls:', JSON.stringify(toolCallList.map((tc: any) => tc.function?.name)));

    const results = await Promise.all(toolCallList.map(async (toolCall: any) => {
      const toolCallId = toolCall.id;
      const functionName = toolCall.function?.name;
      const args = typeof toolCall.function?.arguments === 'string' 
        ? JSON.parse(toolCall.function.arguments) 
        : toolCall.function?.arguments || {};

      try {
        switch (functionName) {
          case 'checkAvailability': {
            const { date } = args;
            if (!date) {
              return { toolCallId, result: 'שגיאה: לא צוין תאריך' };
            }
            const slots = await getAvailableSlots(date);
            const [, month, day] = date.split('-');
            const dateFormatted = `${day}/${month}`;
            if (slots.length === 0) {
              return { toolCallId, result: `אין שעות פנויות ב-${dateFormatted}` };
            }
            return { toolCallId, result: `שעות פנויות ב-${dateFormatted}: ${slots.join(', ')}` };
          }

          case 'bookAppointment': {
            const { date, time, customerName, phone, notes } = args;
            if (!date || !time || !customerName) {
              return { toolCallId, result: 'שגיאה: חסרים פרטים (תאריך, שעה, שם)' };
            }
            const result = await bookAppointment(date, time, customerName, phone, notes);
            if (result.success) {
              // Cache appointment data — will be applied to DB in end-of-call-report handler
              const callId = message?.call?.id;
              if (callId) {
                const appointmentNotes = notes || `פגישת היכרות - נקבעה ע"י טל`;
                pendingAppointments.set(callId, { date: `${date}T${time}:00`, time, notes: appointmentNotes });
                console.log(`[VAPI TOOLS] Cached appointment for call ${callId}: ${date} ${time}`);
              }
              const [, month, day] = date.split('-');
              return { toolCallId, result: `הפגישה נקבעה בהצלחה! ${day}/${month} בשעה ${time} עם ${customerName}` };
            }
            return { toolCallId, result: `שגיאה בקביעת הפגישה: ${result.error}` };
          }

          case 'lookupCaller': {
            // Use phone from args or fall back to caller ID from the call object
            const rawPhone = args.phone || message?.call?.customer?.number || '';
            let normalized = rawPhone.replace(/\D/g, '');
            if (normalized.startsWith('972')) normalized = '0' + normalized.substring(3);
            if (normalized.startsWith('00972')) normalized = '0' + normalized.substring(5);
            const last9 = normalized.slice(-9);

            if (!last9) {
              return { toolCallId, result: 'לא זוהה מספר טלפון של המתקשר' };
            }

            // Search in customers table
            const customer = await prisma.customer.findFirst({
              where: { phone: { contains: last9 } },
              include: { students: { select: { name: true, grade: true } } },
            });

            // Also check latest lead appointment by phone
            const lastLead = await prisma.leadAppointment.findFirst({
              where: { customerPhone: { contains: last9 } },
              orderBy: { createdAt: 'desc' },
            });

            if (customer) {
              let result = `מצאתי לקוח במערכת: שם — ${customer.name}`;
              if (customer.students?.length) {
                result += `. ילדים: ${customer.students.map((s: any) => s.name + (s.grade ? ' כיתה ' + s.grade : '')).join(', ')}`;
              }
              if (lastLead?.interest) result += `. תחום עניין: ${lastLead.interest}`;
              if (lastLead?.childName && !customer.students?.length) result += `. ילד: ${lastLead.childName}`;
              if (customer.notes) {
                const firstNote = customer.notes.split('\n')[0].substring(0, 120);
                result += `. הערות: ${firstNote}`;
              }
              console.log(`[VAPI TOOLS] lookupCaller found customer: ${customer.name} (${rawPhone})`);
              return { toolCallId, result };
            }

            if (lastLead) {
              let result = `לקוח מוכר מפנייה קודמת: שם — ${lastLead.customerName}`;
              if (lastLead.interest) result += `. תחום עניין: ${lastLead.interest}`;
              if (lastLead.childName) result += `. ילד: ${lastLead.childName}`;
              console.log(`[VAPI TOOLS] lookupCaller found lead: ${lastLead.customerName} (${rawPhone})`);
              return { toolCallId, result };
            }

            console.log(`[VAPI TOOLS] lookupCaller — unknown caller: ${rawPhone}`);
            return { toolCallId, result: 'מתקשר לא מוכר במערכת' };
          }

          default:
            return { toolCallId, result: `Unknown function: ${functionName}` };
        }
      } catch (error: any) {
        console.error(`[VAPI TOOLS] Error in ${functionName}:`, error);
        return { toolCallId, result: `שגיאה: ${error.message}` };
      }
    }));

    res.json({ results });
  } catch (error: any) {
    console.error('[VAPI TOOLS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});
