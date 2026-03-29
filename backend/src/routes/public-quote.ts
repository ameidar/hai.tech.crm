import { Router } from 'express';
import { uuidSchema } from '../types/schemas.js';
import { getQuoteById } from '../services/quotes.service.js';
import { prisma } from '../utils/prisma.js';
import { sendEmail } from '../services/notifications.js';

export const publicQuoteRouter = Router();

// GET /api/public/quotes/:id — public, no auth
publicQuoteRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const quote = await getQuoteById(id);

    if (!quote) {
      return res.status(404).json({ error: 'הצעה לא נמצאה' });
    }

    // Allow public access to draft (preview), sent, accepted, converted quotes
    const allowedStatuses = ['draft', 'sent', 'accepted', 'converted'];
    if (!allowedStatuses.includes(quote.status)) {
      return res.status(404).json({ error: 'הצעה לא נמצאה' });
    }

    res.json(quote);
  } catch (error) {
    next(error);
  }
});

// POST /api/public/quotes/:id/respond — client accepts or rejects
publicQuoteRouter.post('/:id/respond', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const { action, clientNotes } = req.body;

    if (!action || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be accept or reject' });
    }

    const quote = await getQuoteById(id);
    if (!quote) {
      return res.status(404).json({ error: 'הצעה לא נמצאה' });
    }

    // Only allow responding to sent quotes
    if (quote.status !== 'sent') {
      return res.status(400).json({ error: 'לא ניתן לענות על הצעה זו' });
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';

    // Update quote status + save client notes
    await prisma.quote.update({
      where: { id },
      data: {
        status: newStatus,
        ...(clientNotes ? { clientNotes } : {}),
      },
    });

    // Send email notification to info@hai.tech
    const actionText = action === 'accept' ? '✅ אושרה' : '❌ נדחתה';
    const emailHtml = `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2>הצעת מחיר ${actionText}</h2>
        <table style="border-collapse: collapse; width: 100%;">
          <tr><td style="padding: 8px; font-weight: bold;">הצעה:</td><td style="padding: 8px;">${quote.quoteNumber}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">מוסד:</td><td style="padding: 8px;">${quote.institutionName}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">איש קשר:</td><td style="padding: 8px;">${quote.contactName || '-'}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">סכום:</td><td style="padding: 8px;">₪${Number(quote.finalAmount || quote.totalAmount).toLocaleString()}</td></tr>
          ${clientNotes ? `<tr><td style="padding: 8px; font-weight: bold;">הערות הלקוח:</td><td style="padding: 8px;">${clientNotes}</td></tr>` : ''}
        </table>
        <p style="margin-top: 16px;">
          <a href="https://crm.orma-ai.com/quotes/${id}" style="background: #2563eb; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none;">
            צפה בהצעה במערכת
          </a>
        </p>
      </div>
    `;

    await sendEmail(
      'info@hai.tech',
      `הצעת מחיר ${quote.quoteNumber} - ${quote.institutionName} - ${actionText}`,
      emailHtml
    ).catch(err => console.error('Failed to send notification email:', err));

    res.json({ status: newStatus, message: action === 'accept' ? 'ההצעה אושרה בהצלחה' : 'ההצעה נדחתה' });
  } catch (error) {
    next(error);
  }
});
