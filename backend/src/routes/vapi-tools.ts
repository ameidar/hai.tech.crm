import { Router, Request, Response } from 'express';
import { getAvailableSlots, bookAppointment } from '../services/google-calendar.js';
import { prisma } from '../utils/prisma.js';
export const vapiToolsRouter = Router();

// Single endpoint that handles all Vapi tool calls
vapiToolsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
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
              // Also update the lead_appointments record in CRM
              try {
                const callId = message?.call?.id;
                if (callId) {
                  const appointmentDate = `${date}T${time}:00`;
                  const appointmentNotes = notes || `פגישת היכרות - נקבעה ע"י טל`;
                  console.log(`[VAPI TOOLS] Updating lead appointment via raw SQL: callId=${callId}, date=${appointmentDate}, time=${time}`);
                  const updateResult = await prisma.$executeRaw`
                    UPDATE lead_appointments 
                    SET appointment_date = ${new Date(appointmentDate)}::timestamp,
                        appointment_time = ${time},
                        appointment_status = 'scheduled',
                        appointment_notes = ${appointmentNotes},
                        updated_at = NOW()
                    WHERE vapi_call_id = ${callId}
                  `;
                  console.log(`[VAPI TOOLS] Updated lead appointment for call ${callId}: ${date} ${time}, rows: ${updateResult}`);
                }
              } catch (dbErr: any) {
                console.error('[VAPI TOOLS] Failed to update lead appointment:', dbErr.message);
              }
              const [, month, day] = date.split('-');
              return { toolCallId, result: `הפגישה נקבעה בהצלחה! ${day}/${month} בשעה ${time} עם ${customerName}` };
            }
            return { toolCallId, result: `שגיאה בקביעת הפגישה: ${result.error}` };
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
