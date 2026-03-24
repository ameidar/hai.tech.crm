/**
 * Lead Appointment Deduplication Utility
 *
 * Problem: when a customer contacts via WhatsApp AND submits a website form,
 * the system creates two separate LeadAppointment records instead of linking to one.
 *
 * Solution: before creating a LeadAppointment, check for an existing one with
 * the same phone (last 9 digits) within the dedup window. If found, update it
 * (add note about additional source) instead of creating a duplicate.
 *
 * Dedup window: 30 days (configurable via LEAD_DEDUP_DAYS env var)
 */

import { prisma } from './prisma.js';

const DEDUP_DAYS = parseInt(process.env.LEAD_DEDUP_DAYS || '30', 10);

/** Normalize a phone number to its last 9 digits */
function last9(phone: string): string {
  return phone.replace(/\D/g, '').slice(-9);
}

export interface LeadAppointmentInput {
  customerId?: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  childName?: string | null;
  interest?: string | null;
  source: string;
  appointmentStatus?: string;
  appointmentNotes?: string | null;
  callSummary?: string | null;
  callStatus?: string | null;
  callDirection?: string | null;
  vapiCallId?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adId?: string | null;
  adName?: string | null;
  adsetName?: string | null;
  formId?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LeadRecord = any; // full Prisma LeadAppointment shape

export interface LeadAppointmentResult {
  lead: LeadRecord;
  isDuplicate: boolean; // true = existing record was updated, false = new record created
}

/**
 * Find an existing open LeadAppointment by phone, or create a new one.
 *
 * "Open" = appointmentStatus is NOT 'done' / 'cancelled' / 'rejected'
 * Window = DEDUP_DAYS days
 */
export async function findOrCreateLeadAppointment(
  input: LeadAppointmentInput
): Promise<LeadAppointmentResult> {
  const { customerPhone, source, appointmentNotes, callSummary, customerId, customerEmail } = input;

  if (!customerPhone) {
    // No phone → can't dedup, just create
    const lead = await prisma.leadAppointment.create({ data: buildData(input) });
    return { lead, isDuplicate: false };
  }

  const phoneLast9 = last9(customerPhone);
  const windowStart = new Date(Date.now() - DEDUP_DAYS * 24 * 60 * 60 * 1000);

  // Find existing open lead with same phone in the dedup window
  const existing = await prisma.$queryRaw<{ id: string; source: string; appointment_status: string; appointment_notes: string | null }[]>`
    SELECT id, source, appointment_status, appointment_notes
    FROM lead_appointments
    WHERE deleted_at IS NULL
      AND appointment_status NOT IN ('done', 'cancelled', 'rejected')
      AND created_at >= ${windowStart}
      AND RIGHT(REPLACE(REPLACE(REPLACE(customer_phone, '+', ''), '-', ''), ' ', ''), 9) = ${phoneLast9}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (existing.length > 0) {
    const found = existing[0];

    // Build a note about the additional source
    const timestamp = new Date().toISOString();
    const extraNote = [
      `\n---\n[${timestamp}] קישור נוסף ממקור: ${source}`,
      appointmentNotes ? `פרטים: ${appointmentNotes}` : null,
      callSummary ? `סיכום: ${callSummary}` : null,
    ].filter(Boolean).join(' | ');

    const updatedNotes = found.appointment_notes
      ? `${found.appointment_notes}${extraNote}`
      : extraNote.trimStart();

    // Update existing record: merge notes + fill in missing fields
    await prisma.$executeRaw`
      UPDATE lead_appointments
      SET
        appointment_notes = ${updatedNotes},
        customer_id       = COALESCE(customer_id, ${customerId ?? null}),
        customer_email    = COALESCE(customer_email, ${customerEmail ?? null}),
        updated_at        = NOW()
      WHERE id = ${found.id}
    `;

    console.log(`[lead-dedup] Merged duplicate lead — existing ${found.id} (${found.source}) + new source ${source} for phone ...${phoneLast9}`);

    const updated = await prisma.leadAppointment.findUnique({ where: { id: found.id } });
    return { lead: updated as any, isDuplicate: true };
  }

  // No existing lead — create new
  const lead = await prisma.leadAppointment.create({ data: buildData(input) });
  console.log(`[lead-dedup] New lead ${lead.id} created from ${source} for phone ...${phoneLast9}`);
  return { lead, isDuplicate: false };
}

function buildData(input: LeadAppointmentInput) {
  return {
    customerId:        input.customerId ?? null,
    customerName:      input.customerName,
    customerPhone:     input.customerPhone,
    customerEmail:     input.customerEmail ?? null,
    childName:         input.childName ?? null,
    interest:          input.interest ?? null,
    source:            input.source,
    appointmentStatus: input.appointmentStatus ?? 'pending',
    appointmentNotes:  input.appointmentNotes ?? null,
    callSummary:       input.callSummary ?? null,
    callStatus:        input.callStatus ?? null,
    callDirection:     input.callDirection ?? null,
    vapiCallId:        input.vapiCallId ?? null,
    campaignId:        input.campaignId ?? null,
    campaignName:      input.campaignName ?? null,
    adId:              input.adId ?? null,
    adName:            input.adName ?? null,
    adsetName:         input.adsetName ?? null,
    formId:            input.formId ?? null,
  };
}
