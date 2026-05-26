import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, salesOrAbove } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { prisma } from '../utils/prisma.js';
import { createPaymentForm } from '../services/morning/payment-forms.js';
import { DOCUMENT_TYPES } from '../services/morning/documents.js';
import { createMorningClient, findClientForCustomer } from '../services/morning/clients.js';
import { randomBytes } from 'crypto';

export const paymentLinksRouter = Router();
paymentLinksRouter.use(authenticate);

const createSchema = z.object({
  description: z.string().min(1, 'description required').max(300),
  amount: z.number().positive('amount must be > 0'),
  maxPayments: z.number().int().min(1).max(36).optional(),
  vatType: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  documentType: z.union([z.literal(400), z.literal(320), z.literal(305)]).optional(),
  // Customer IDs in this CRM are string IDs. Most new rows are UUIDs, but a
  // large part of the Fireberry import kept legacy/cuid-like IDs, so requiring
  // UUID here breaks valid customer selections from the CRM lookup.
  customerId: z.string().min(1).max(64).optional(),
  client: z.object({
    name: z.string().optional().or(z.literal('')),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional(),
    taxId: z.string().optional(),
  }).optional(),
});

// Crockford-style base32, no ambiguous chars. 32^5 ≈ 33M combos.
const SHORT_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
function generateShortCode(): string {
  const bytes = randomBytes(5);
  let out = '';
  for (let i = 0; i < 5; i++) out += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length];
  return out;
}

// Find or create the matching Morning client UUID for a CRM customer and cache
// it on the customer row. Returns null if Morning is unreachable so the caller
// can still issue the payment link with inline client info.
export async function ensureMorningClientId(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return null;
  if (customer.morningClientId) return customer.morningClientId;

  try {
    const existing = await findClientForCustomer({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    });
    let morningId = existing?.id;
    if (!morningId) {
      const created = await createMorningClient({
        name: customer.name,
        emails: customer.email ? [customer.email] : undefined,
        phone: customer.phone ?? undefined,
        address: customer.address ?? undefined,
        city: customer.city ?? undefined,
      });
      morningId = created.id;
    }
    await prisma.customer.update({
      where: { id: customerId },
      data: { morningClientId: morningId },
    });
    return morningId;
  } catch {
    return null;
  }
}

// POST /api/payment-links — sales+ generates a Morning payment link
paymentLinksRouter.post('/', salesOrAbove, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    }
    const input = parsed.data;
    const documentType = input.documentType ?? DOCUMENT_TYPES.RECEIPT;

    let morningClientId: string | undefined;
    if (input.customerId) {
      const resolved = await ensureMorningClientId(input.customerId);
      if (resolved) morningClientId = resolved;
    }
    const client = input.client ?? {};
    const clientName = client.name?.trim() || 'לקוח';
    const clientEmail = client.email?.trim() || '';
    const clientPhone = client.phone?.trim() || '';
    const clientTaxId = client.taxId?.trim() || '';

    const result = await createPaymentForm({
      description: input.description,
      amount: input.amount,
      // Morning's hosted form treats maxPayments as the exact installment count
      // for this payment URL. The CRM short link handles "up to N" by letting
      // the customer choose and then generating a URL for the chosen count.
      maxPayments: 1,
      vatType: input.vatType,
      type: documentType,
      client: {
        id: morningClientId,
        name: clientName,
        emails: clientEmail ? [clientEmail] : undefined,
        phone: clientPhone || undefined,
        taxId: clientTaxId || undefined,
      },
    });

    let saved: { code: string; id: string } | null = null;
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      const code = generateShortCode();
      try {
        const created = await prisma.paymentLink.create({
          data: {
            code,
            description: input.description,
            amount: input.amount,
            maxPayments: input.maxPayments ?? 1,
            documentType,
            vatType: input.vatType ?? 0,
            morningUrl: result.url,
            customerId: input.customerId,
            clientName,
            clientEmail: clientEmail || null,
            clientPhone: clientPhone || null,
            clientTaxId: clientTaxId || null,
            createdBy: (req as any).user?.id ?? null,
          },
          select: { code: true, id: true },
        });
        saved = created;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
      }
    }
    if (!saved) throw new AppError(500, 'Failed to allocate a unique short code — try again');

    const host = req.get('host');
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const shortUrl = `${proto}://${host}/pl/${saved.code}`;

    res.json({
      url: result.url,
      shortUrl,
      code: saved.code,
      description: input.description,
      amount: input.amount,
      maxPayments: input.maxPayments ?? 1,
      documentType,
      morningClientLinked: !!morningClientId,
    });
  } catch (err: any) {
    if (err?.status === 400 || err?.body?.errorCode) {
      return next(new AppError(400, err?.body?.errorMessage || err.message));
    }
    next(err);
  }
});

// GET /api/payment-links — list recent links (sales+)
paymentLinksRouter.get('/', salesOrAbove, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 200);
    const items = await prisma.paymentLink.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    });
    res.json({ items });
  } catch (err) { next(err); }
});
