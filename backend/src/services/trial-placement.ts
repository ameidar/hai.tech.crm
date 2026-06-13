/**
 * Trial-lesson placement automation.
 *
 * When a payment arrives for anything OTHER than a digital self-learning course,
 * the paying customer needs to be scheduled into a cycle. This service:
 *   1. ensures a Student record exists (the incoming name is the PARENT's name —
 *      flagged in notes so staff rename it to the child),
 *   2. marks the customer's lead status as `waiting_placement` when the child has
 *      no active cycle yet,
 *   3. notifies the placement WhatsApp group so someone schedules the child.
 *
 * Digital courses on hai.tech are always either "למידה עצמית" in the description
 * or priced 497₪ — those require no placement.
 *
 * Designed to be fire-and-forget: it never throws, so a failure here can never
 * break the payment-creation flow that called it.
 */
import { prisma } from '../utils/prisma.js';
import { sendWhatsAppToChat } from './messaging.js';

const PLACEMENT_GROUP_CHAT_ID = '120363353459332838@g.us';
const DIGITAL_COURSE_AMOUNT = 497;

interface PaymentLike {
  description?: string | null;
  amount: unknown;
  status?: string | null;
}

/**
 * True when this payment should trigger placement (i.e. it is NOT a digital
 * self-learning course and is not an obvious test record).
 */
export function needsPlacement(p: PaymentLike): boolean {
  if (p.status && p.status !== 'paid') return false;

  const amount = Number(p.amount) || 0;
  const desc = p.description || '';

  // Digital self-learning courses never need placement.
  if (desc.includes('למידה עצמית')) return false;
  if (amount === DIGITAL_COURSE_AMOUNT) return false;

  // Obvious test / junk records.
  if (amount < 5) return false;
  if (desc.includes('בדיקה')) return false;

  return true;
}

/**
 * Runs the placement automation for a freshly-created payment.
 * Safe to call without awaiting the result — all errors are swallowed.
 */
export async function handlePostPaymentPlacement(paymentId: string): Promise<void> {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        customerId: true,
        customerName: true,
        amount: true,
        description: true,
        status: true,
      },
    });
    if (!payment || !needsPlacement(payment)) return;

    if (!payment.customerId) {
      console.log(`[TrialPlacement] payment ${paymentId} has no linked customer — skipping`);
      return;
    }

    const customer = await prisma.customer.findUnique({
      where: { id: payment.customerId },
      select: {
        id: true,
        name: true,
        phone: true,
        leadStatus: true,
        students: {
          where: { deletedAt: null },
          select: {
            id: true,
            registrations: {
              where: { deletedAt: null, status: { in: ['registered', 'active'] } },
              select: { cycle: { select: { status: true } } },
            },
          },
        },
      },
    });
    if (!customer) return;

    const hasActiveCycle = customer.students.some((s) =>
      s.registrations.some((r) => r.cycle?.status === 'active')
    );

    // 1) Ensure a Student record exists. The incoming name is the parent's name,
    //    so flag it for staff to rename to the child.
    if (customer.students.length === 0) {
      await prisma.student.create({
        data: {
          customerId: customer.id,
          name: customer.name || payment.customerName || 'תלמיד',
          notes: 'נוצר אוטומטית מתשלום — נא לעדכן לשם הילד',
        },
      });
      console.log(`[TrialPlacement] created student for customer ${customer.id}`);
    }

    // 2) Child already has an active cycle — nothing to schedule.
    if (hasActiveCycle) return;

    // 3) Flag for placement + notify the group (idempotent — skip if already waiting).
    if (customer.leadStatus === 'waiting_placement') return;

    await prisma.customer.update({
      where: { id: customer.id },
      data: { leadStatus: 'waiting_placement' },
    });

    const msg =
      `🧩 דרוש שיבוץ!\n` +
      `👤 ${customer.name}\n` +
      (customer.phone ? `📱 ${customer.phone}\n` : '') +
      `💰 התקבל תשלום: ₪${Number(payment.amount).toLocaleString()}\n` +
      (payment.description ? `📋 ${payment.description}\n` : '') +
      `\n🔗 crm.orma-ai.com/customers/${customer.id}`;

    await sendWhatsAppToChat(PLACEMENT_GROUP_CHAT_ID, msg);
    console.log(`[TrialPlacement] flagged customer ${customer.id} for placement + notified group`);
  } catch (e) {
    console.error('[TrialPlacement] Error:', e);
  }
}
