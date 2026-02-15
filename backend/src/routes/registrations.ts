import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { updateRegistrationSchema, uuidSchema } from '../types/schemas.js';
import { z } from 'zod';
import { parsePaginationParams, paginatedResponse } from '../utils/pagination.js';
import { sendEmail, sendWhatsAppMessage } from '../services/notifications.js';

export const registrationsRouter = Router();

registrationsRouter.use(authenticate);

// List registrations
registrationsRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip, take, sort, order } = parsePaginationParams(req.query);
    const status = req.query.status as string | undefined;
    const paymentStatus = req.query.paymentStatus as string | undefined;
    const cycleId = req.query.cycleId as string | undefined;
    const studentId = req.query.studentId as string | undefined;

    const where = {
      ...(status && { status: status as any }),
      ...(paymentStatus && { paymentStatus: paymentStatus as any }),
      ...(cycleId && { cycleId }),
      ...(studentId && { studentId }),
    };

    const [registrations, total] = await Promise.all([
      prisma.registration.findMany({
        where,
        include: {
          student: {
            include: {
              customer: { select: { id: true, name: true, phone: true, email: true } },
            },
          },
          cycle: {
            include: {
              course: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { [sort || 'registrationDate']: order },
        skip,
        take,
      }),
      prisma.registration.count({ where }),
    ]);

    res.json(paginatedResponse(registrations, total, page, limit));
  } catch (error) {
    next(error);
  }
});

// Get registration by ID
registrationsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const registration = await prisma.registration.findUnique({
      where: { id },
      include: {
        student: {
          include: {
            customer: true,
          },
        },
        cycle: {
          include: {
            course: true,
            branch: true,
            instructor: { select: { id: true, name: true } },
          },
        },
        attendance: {
          include: {
            meeting: {
              select: { id: true, scheduledDate: true, status: true },
            },
          },
          orderBy: { recordedAt: 'desc' },
        },
      },
    });

    if (!registration) {
      throw new AppError(404, 'Registration not found');
    }

    res.json(registration);
  } catch (error) {
    next(error);
  }
});

// Update registration
registrationsRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateRegistrationSchema.parse(req.body);

    const registration = await prisma.registration.update({
      where: { id },
      data: {
        ...data,
        cancellationDate: data.status === 'cancelled' ? new Date() : undefined,
      },
      include: {
        student: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
        cycle: {
          select: { id: true, name: true },
        },
      },
    });

    res.json(registration);
  } catch (error) {
    next(error);
  }
});

// Delete registration
registrationsRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    await prisma.registration.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Cancel registration
registrationsRouter.post('/:id/cancel', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);

    const registration = await prisma.registration.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancellationDate: new Date(),
        cancellationReason: reason,
      },
      include: {
        student: { select: { name: true } },
        cycle: { select: { name: true } },
      },
    });

    res.json(registration);
  } catch (error) {
    next(error);
  }
});

// Send cancellation form to customer
registrationsRouter.post('/:id/send-cancellation-form', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const registration = await prisma.registration.findUnique({
      where: { id },
      include: {
        student: {
          include: {
            customer: { select: { id: true, name: true, phone: true, email: true } },
          },
        },
        cycle: {
          include: {
            course: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!registration) {
      throw new AppError(404, 'Registration not found');
    }

    const customer = registration.student.customer;
    if (!customer) {
      throw new AppError(400, 'לא נמצא לקוח להרשמה זו');
    }

    const token = randomUUID();
    const courseName = registration.cycle.course?.name || registration.cycle.name;

    await prisma.cancellationRequest.create({
      data: {
        registrationId: id,
        customerName: customer.name,
        studentName: registration.student.name,
        token,
        status: 'pending',
      },
    });

    const formUrl = `http://129.159.133.209:3002/cancel/${token}`;

    // Send email
    if (customer.email) {
      const emailHtml = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 0;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 40px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">🎯 Hai.Tech</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <h2 style="color: #1f2937;">שלום ${customer.name},</h2>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
                קיבלנו את פנייתך בנוגע לביטול הקורס <strong>${courseName}</strong> עבור ${registration.student.name}.
              </p>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
                על מנת להשלים את תהליך הביטול, נא למלא את הטופס הבא:
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${formUrl}" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                  מילוי טופס ביטול →
                </a>
              </div>
              <p style="color: #9ca3af; font-size: 14px;">אם לא ביקשת ביטול, ניתן להתעלם מהודעה זו.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">📧 info@hai.tech | 🌐 hai.tech</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
      await sendEmail(customer.email, `טופס ביטול - ${courseName} - Hai.Tech`, emailHtml);
    }

    // Send WhatsApp
    if (customer.phone) {
      const whatsappMessage = `שלום ${customer.name},

קיבלנו את פנייתך בנוגע לביטול הקורס ${courseName} עבור ${registration.student.name}.

למילוי טופס הביטול:
${formUrl}

צוות Hai.Tech 💙`;
      await sendWhatsAppMessage(customer.phone, whatsappMessage);
    }

    res.json({ success: true, token, message: 'טופס ביטול נשלח ללקוח' });
  } catch (error) {
    next(error);
  }
});

// Update payment status
registrationsRouter.post('/:id/payment', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = z.object({
      paymentStatus: z.enum(['unpaid', 'partial', 'paid']),
      paymentMethod: z.enum(['credit', 'transfer', 'cash']).optional(),
      amount: z.number().positive().optional(),
      invoiceLink: z.string().optional(),
    }).parse(req.body);

    const registration = await prisma.registration.update({
      where: { id },
      data,
      include: {
        student: { select: { name: true } },
        cycle: { select: { name: true } },
      },
    });

    res.json(registration);
  } catch (error) {
    next(error);
  }
});
