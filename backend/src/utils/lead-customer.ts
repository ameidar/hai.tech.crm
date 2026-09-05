/**
 * Shared utility: find or create a Customer from lead data.
 * Used by all lead sources (webhook, VAPI, Facebook, WhatsApp).
 *
 * - Matches by phone (last 9 digits) or email
 * - Existing customer → appends note to communication history
 * - New customer → creates with source + notes
 */
import { prisma } from './prisma.js';
import { Prisma } from '@prisma/client';

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

    const updateData: Prisma.CustomerUpdateInput = {
      notes: existing.notes
        ? `${existing.notes}\n---\n${historyNote}`
        : historyNote,
    };

    if (!existing.phone && normalizedPhone) {
      const phoneConflict = await findExistingCustomerByPhoneOrEmail(last9, null);
      if (!phoneConflict || phoneConflict.id === existing.id) {
        updateData.phone = phone!;
      }
    }

    if (!existing.email && email) {
      const emailConflict = await findExistingCustomerByPhoneOrEmail(null, email);
      if (!emailConflict || emailConflict.id === existing.id) {
        updateData.email = email;
      }
    }

    await prisma.customer.update({
      where: { id: existing.id },
      data: updateData,
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
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }

    const conflict = await findExistingCustomerByPhoneOrEmail(last9, email);
    if (conflict) {
      const duplicateFields = Array.isArray(error.meta?.target)
        ? error.meta.target.join(', ')
        : 'phone/email';
      await prisma.customer.update({
        where: { id: conflict.id },
        data: {
          notes: conflict.notes
            ? `${conflict.notes}\n---\n${historyNote}\n[שים לב: פנייה אוחדה אחרי כפילות בשדה ${duplicateFields}]`
            : `${historyNote}\n[שים לב: פנייה אוחדה אחרי כפילות בשדה ${duplicateFields}]`,
          source: conflict.source || source,
        },
      });
      return { customerId: conflict.id, isNew: false };
    }

    const customer = await prisma.customer.create({
      data: {
        name,
        phone: null,
        email: null,
        source,
        notes: `${historyNote}\n[שים לב: נוצר ללא טלפון/מייל בגלל כפילות קיימת במערכת]`,
      },
    });
    return { customerId: customer.id, isNew: true };
  }
}

async function findExistingCustomerByPhoneOrEmail(last9: string | null, email?: string | null) {
  if (last9) {
    const byPhone = await prisma.customer.findFirst({
      where: { phone: { endsWith: last9 } },
    });
    if (byPhone) return byPhone;
  }

  if (email) {
    return prisma.customer.findFirst({ where: { email } });
  }

  return null;
}
