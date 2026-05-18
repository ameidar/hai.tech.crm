import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, salesOrAbove } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createPaymentForm } from '../services/morning/payment-forms.js';

export const paymentLinksRouter = Router();
paymentLinksRouter.use(authenticate);

const createSchema = z.object({
  description: z.string().min(1, 'description required').max(300),
  amount: z.number().positive('amount must be > 0'),
  maxPayments: z.number().int().min(1).max(36).optional(),
  vatType: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  type: z.number().int().optional(),
  client: z.object({
    name: z.string().min(1, 'client.name required'),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional(),
    taxId: z.string().optional(),
  }),
});

// POST /api/payment-links — sales+ generates a Morning payment link
paymentLinksRouter.post('/', salesOrAbove, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    }
    const input = parsed.data;

    const result = await createPaymentForm({
      description: input.description,
      amount: input.amount,
      maxPayments: input.maxPayments,
      vatType: input.vatType,
      type: input.type,
      client: {
        name: input.client.name,
        emails: input.client.email ? [input.client.email] : undefined,
        phone: input.client.phone,
        taxId: input.client.taxId,
      },
    });

    res.json({
      url: result.url,
      description: input.description,
      amount: input.amount,
      maxPayments: input.maxPayments ?? 1,
    });
  } catch (err: any) {
    if (err?.status === 400 || err?.body?.errorCode) {
      return next(new AppError(400, err?.body?.errorMessage || err.message));
    }
    next(err);
  }
});
