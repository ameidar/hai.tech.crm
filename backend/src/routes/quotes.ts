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
import { renderQuoteVideo, getVideoStatus, getVideoUrl, setRenderStatus } from '../services/video.service.js';
import { sendEmail } from '../services/email/sender.js';

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

// Send quote (update status + email)
quotesRouter.post('/:id/send', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const quote = await getQuoteById(id);

    let emailSent = false;
    if (quote.contactEmail) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://129.159.133.209:3002';
      const publicUrl = `${frontendUrl}/public/quote/${id}`;

      await sendEmail({
        to: quote.contactEmail,
        subject: `הצעת מחיר מדרך ההייטק - ${quote.institutionName}`,
        html: `
          <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#0891b2,#06b6d4);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
              <h1 style="color:white;margin:0;font-size:24px;">דרך ההייטק</h1>
              <p style="color:#e0f2fe;margin:8px 0 0;">הצעת מחיר מיוחדת עבורכם</p>
            </div>
            <div style="padding:24px;background:#f8fafc;border:1px solid #e2e8f0;">
              <p style="font-size:16px;">שלום ${quote.contactName},</p>
              <p>הכנו עבורכם הצעת מחיר מותאמת אישית.</p>
              <div style="text-align:center;margin:24px 0;">
                <a href="${publicUrl}" style="display:inline-block;background:#0891b2;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;">
                  צפו בהצעה המלאה →
                </a>
              </div>
              <p style="color:#64748b;font-size:14px;">סה״כ: ₪${Number(quote.finalAmount || quote.totalAmount).toLocaleString()}</p>
            </div>
            <div style="padding:16px;text-align:center;color:#94a3b8;font-size:12px;">
              דרך ההייטק | hai.tech
            </div>
          </div>
        `,
      });
      emailSent = true;
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

// Generate video
quotesRouter.post('/:id/generate-video', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const quote = await getQuoteById(id);

    const props = {
      institutionName: quote.institutionName,
      items: (quote.items || []).map((item: any) => ({
        courseName: item.courseName || 'שירות',
        type: (item.groups === 1 && item.meetingsPerGroup === 1 && item.description) ? 'project' : 'education',
      })),
      totalAmount: Number(quote.finalAmount || quote.totalAmount || 0),
    };

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

// Get video status / proxy video
quotesRouter.get('/:id/video', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    
    // Check render server status
    const status = await getVideoStatus(id);
    
    if (status === 'done') {
      // Proxy the video from render server
      const videoUrl = getVideoUrl(id);
      const videoRes = await fetch(videoUrl);
      if (videoRes.ok && videoRes.body) {
        res.setHeader('Content-Type', 'video/mp4');
        const reader = videoRes.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { res.end(); break; }
            res.write(value);
          }
        };
        await pump();
      } else {
        res.status(404).json({ status: 'not_found' });
      }
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
