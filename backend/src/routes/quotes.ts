import { Router } from 'express';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { paginationSchema, uuidSchema } from '../types/schemas.js';
import {
  listQuotes,
  getQuoteById,
  createQuote,
  updateQuote,
  deleteQuote,
  generateQuoteContent,
  generateContentPreview,
  convertToOrder,
} from '../services/quotes.service.js';
import { sendEmail } from '../services/email/sender.js';
import { renderQuoteVideo, getVideoPath, setRenderStatus, getRenderStatus } from '../services/video.service.js';

export const quotesRouter = Router();

quotesRouter.use(authenticate);

// List quotes
quotesRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;

    const result = await listQuotes({ status, search, page, limit });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get quote by ID
quotesRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const quote = await getQuoteById(id);
    res.json(quote);
  } catch (error) {
    next(error);
  }
});

// Create quote
quotesRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const quote = await createQuote({
      ...req.body,
      createdById: req.user?.userId,
    });
    res.status(201).json(quote);
  } catch (error) {
    next(error);
  }
});

// Update quote
quotesRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const quote = await updateQuote(id, req.body);
    res.json(quote);
  } catch (error) {
    next(error);
  }
});

// Delete quote
quotesRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    await deleteQuote(id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Send quote (send email + update status to sent)
quotesRouter.post('/:id/send', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const quote = await getQuoteById(id);
    if (!quote) {
      return res.status(404).json({ error: 'הצעה לא נמצאה' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const publicUrl = `${frontendUrl}/public/quote/${id}`;
    let emailSent = false;

    if (quote.contactEmail) {
      const itemsSummary = (quote.items || [])
        .map((item: any) => `<li style="padding:4px 0;">${item.courseName || 'שירות'} — ₪${Number(item.subtotal).toLocaleString()}</li>`)
        .join('');

      const finalAmount = Number(quote.finalAmount || quote.totalAmount || 0);

      const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f3f4f6;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#2563eb 0%,#06b6d4 100%);color:white;padding:30px;text-align:center;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;font-size:28px;">דרך ההייטק</h1>
      <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">חינוך טכנולוגי מתקדם</p>
    </div>
    <div style="background:white;padding:30px;border:1px solid #e5e7eb;">
      <p style="font-size:18px;color:#1f2937;">שלום ${quote.contactName},</p>
      <p style="color:#4b5563;">שמחים לשלוח לך את הצעת המחיר שהכנו עבור <strong>${quote.institutionName}</strong>.</p>
      
      <div style="background:#f0f9ff;border-right:4px solid #2563eb;padding:15px;margin:20px 0;border-radius:4px;">
        <p style="margin:0 0 8px;font-weight:bold;color:#1e40af;">סיכום ההצעה:</p>
        <ul style="margin:0;padding:0 20px;color:#374151;">${itemsSummary}</ul>
        <p style="margin:12px 0 0;font-size:20px;font-weight:bold;color:#059669;">סה״כ: ₪${finalAmount.toLocaleString()}</p>
      </div>

      <div style="text-align:center;margin:30px 0;">
        <a href="${publicUrl}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#06b6d4);color:white;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:18px;font-weight:bold;">צפו בהצעה המלאה</a>
      </div>

      <p style="color:#6b7280;font-size:13px;">אם יש לכם שאלות, אנחנו כאן בשבילכם.</p>
    </div>
    <div style="background:#f9fafb;padding:20px;text-align:center;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">דרך ההייטק — חינוך טכנולוגי מתקדם<br>info@hai.tech | 03-1234567</p>
    </div>
  </div>
</body>
</html>`;

      const result = await sendEmail({
        to: quote.contactEmail,
        subject: `הצעת מחיר ${quote.quoteNumber} — דרך ההייטק`,
        html,
      });
      emailSent = result.success;
    }

    const updated = await updateQuote(id, { status: 'sent' });
    res.json({ ...updated, emailSent });
  } catch (error) {
    next(error);
  }
});

// Accept quote
quotesRouter.post('/:id/accept', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const quote = await updateQuote(id, { status: 'accepted' });
    res.json(quote);
  } catch (error) {
    next(error);
  }
});

// Reject quote
quotesRouter.post('/:id/reject', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const quote = await updateQuote(id, { status: 'rejected' });
    res.json(quote);
  } catch (error) {
    next(error);
  }
});

// Generate AI content preview (without saving to a quote)
quotesRouter.post('/generate-content-preview', async (req, res, next) => {
  try {
    const result = await generateContentPreview(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Generate AI content for quote
quotesRouter.post('/:id/generate', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const result = await generateQuoteContent(id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Convert quote to order
quotesRouter.post('/:id/convert', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const result = await convertToOrder(id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Generate marketing video for quote
quotesRouter.post('/:id/generate-video', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const quote = await getQuoteById(id);
    if (!quote) {
      return res.status(404).json({ error: 'הצעה לא נמצאה' });
    }

    // Build props for Remotion
    const props = {
      institutionName: quote.institutionName,
      items: (quote.items || []).map((item: any) => ({
        courseName: item.courseName || 'שירות',
        type: (item.groups === 1 && item.meetingsPerGroup === 1 && item.description) ? 'project' : 'education',
      })),
      totalAmount: Number(quote.finalAmount || quote.totalAmount || 0),
    };

    // Start render in background
    setRenderStatus(id, 'rendering');
    renderQuoteVideo(id, props)
      .then(() => setRenderStatus(id, 'done'))
      .catch((err) => {
        console.error('Video render failed:', err);
        setRenderStatus(id, 'error');
      });

    res.json({ status: 'rendering', message: 'הסרטון בהכנה...' });
  } catch (error) {
    next(error);
  }
});

// Get video status / serve video
quotesRouter.get('/:id/video', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const status = getRenderStatus(id);
    const videoPath = await getVideoPath(id);

    if (videoPath) {
      res.sendFile(videoPath);
    } else if (status === 'rendering') {
      res.status(202).json({ status: 'rendering', message: 'הסרטון עדיין בהכנה...' });
    } else if (status === 'error') {
      res.status(500).json({ status: 'error', message: 'שגיאה ביצירת הסרטון' });
    } else {
      res.status(404).json({ status: 'not_found', message: 'סרטון לא נמצא' });
    }
  } catch (error) {
    next(error);
  }
});
