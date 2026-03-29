/**
 * Shared utility: find or create a Customer from lead data.
 * Used by all lead sources (webhook, VAPI, Facebook, WhatsApp).
 *
 * - Matches by phone (last 9 digits) or email
 * - Existing customer → appends note to communication history
 * - New customer → creates with source + notes
 */
import { prisma } from './prisma.js';

export interface LeadData {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string;
  notes?: string;
  childName?: string | null;
  childAge?: string | null;
}

export async function findOrCreateCustomer(lead: LeadData): Promise<{
  customerId: string | null;
  isNew: boolean;
}> {
  const { name, phone, email, source = 'unknown', notes, childName, childAge } = lead;

  // Normalize phone — strip non-digits
  const normalizedPhone = phone ? phone.replace(/\D/g, '') : null;
  const last9 = normalizedPhone ? normalizedPhone.slice(-9) : null;

  let existing = null;

  // 1. Search by phone (last 9 digits match)
  if (last9) {
    existing = await prisma.customer.findFirst({
      where: { phone: { endsWith: last9 } },
    });
  }

  // 2. Fallback — search by email
  if (!existing && email) {
    existing = await prisma.customer.findFirst({
      where: { email },
    });
  }

  const timestamp = new Date().toISOString();

  if (existing) {
    // Update communication history
    const historyNote = notes
      ? `[${timestamp}] ${source}: ${notes}`
      : `[${timestamp}] ${source}: פנייה חדשה`;

    await prisma.customer.update({
      where: { id: existing.id },
      data: {
        notes: existing.notes
          ? `${existing.notes}\n---\n${historyNote}`
          : historyNote,
        // Update phone/email if we have them and they're missing
        phone: existing.phone ?? (normalizedPhone ? phone! : undefined),
        email: existing.email ?? (email || undefined),
      },
    });

    return { customerId: existing.id, isNew: false };
  }

  // Not found — create only if we have a name
  if (!name) {
    return { customerId: null, isNew: false };
  }

  const historyNote = notes
    ? `[${timestamp}] ${source}: ${notes}`
    : `[${timestamp}] ${source}: פנייה חדשה`;

  try {
    const customer = await prisma.customer.create({
      data: {
        name,
        phone: phone || null,
        email: email || null,
        source,
        notes: historyNote,
        students: childName ? {
          create: [{
            name: childName,
            notes: childAge ? `גיל: ${childAge}` : undefined,
          }],
        } : undefined,
      },
    });
    return { customerId: customer.id, isNew: true };
  } catch {
    // Phone might conflict (duplicate unique) — try without phone
    const customer = await prisma.customer.create({
      data: {
        name,
        phone: null,
        email: email || null,
        source,
        notes: `${historyNote}\n[שים לב: הטלפון ${phone} כבר קיים במערכת]`,
      },
    });
    return { customerId: customer.id, isNew: true };
  }
}
