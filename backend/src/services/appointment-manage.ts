/**
 * Customer self-service for lead appointments (intro meetings).
 * Generates the public view/cancel link and sends the booking
 * confirmation WhatsApp with that link.
 *
 * Confirmation message is GATED by APPOINTMENT_CONFIRMATION_WA_ENABLED=true
 * (default: off) — same convention as LEAD_WELCOME_WA_ENABLED.
 * The manage link is always available in the CRM (copy from lead detail).
 */
import crypto from 'crypto';
import { config } from '../config.js';
import { sendWhatsAppMessage } from './notifications.js';

const APPOINTMENT_TOKEN_SECRET =
  process.env.APPOINTMENT_TOKEN_SECRET || 'haitech-appointment-manage-2026';

export function generateAppointmentToken(appointmentId: string): string {
  const hmac = crypto.createHmac('sha256', APPOINTMENT_TOKEN_SECRET);
  hmac.update(appointmentId);
  return hmac.digest('hex').substring(0, 32);
}

export function verifyAppointmentToken(appointmentId: string, token: string): boolean {
  const expected = Buffer.from(generateAppointmentToken(appointmentId));
  const actual = Buffer.from(token || '');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function buildAppointmentManageUrl(appointmentId: string): string {
  return `${config.frontendUrl}/appointment/${appointmentId}/${generateAppointmentToken(appointmentId)}`;
}

export async function sendAppointmentConfirmation(appointment: {
  id: string;
  customerName: string;
  customerPhone: string;
  appointmentDate: Date | null;
  appointmentTime: string | null;
}): Promise<boolean> {
  if (process.env.APPOINTMENT_CONFIRMATION_WA_ENABLED !== 'true') return false;
  if (!appointment.customerPhone || !appointment.appointmentDate) return false;

  const firstName = appointment.customerName?.split(' ')[0] || '';
  const dateStr = new Date(appointment.appointmentDate).toLocaleDateString('he-IL', {
    timeZone: 'Asia/Jerusalem',
  });
  const lines = [
    `היי ${firstName} 👋`,
    'הפגישה שלך עם דרך ההייטק נקבעה בהצלחה!',
    `📅 תאריך: ${dateStr}`,
  ];
  if (appointment.appointmentTime) lines.push(`🕐 שעה: ${appointment.appointmentTime}`);
  lines.push('', 'לצפייה בפרטי הפגישה או לביטול:', buildAppointmentManageUrl(appointment.id));

  return sendWhatsAppMessage(appointment.customerPhone, lines.join('\n'));
}
