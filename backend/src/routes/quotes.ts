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
import { renderQuoteVideo, getVideoStatus, getVideoUrl, setRenderStatus, persistVideo, getPersistedVideoPath, isVimeoUrl } from '../services/video.service.js';
import fs from 'fs';
import { prisma } from '../utils/prisma.js';
import { sendEmail } from '../services/email/sender.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';

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

    await logAudit({ action: 'CREATE', entity: 'Quote', entityId: quote.id, newValue: { institutionName: quote.institutionName, status: quote.status, totalAmount: quote.totalAmount }, req });

    res.status(201).json(quote);
  } catch (error) {
    next(error);
  }
});

// Update quote
quotesRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const oldQuote = await getQuoteById(id);
    const quote = await updateQuote(id, req.body);
    await logUpdateAudit({ entity: 'Quote', entityId: id, oldRecord: oldQuote, newRecord: quote, req });
    res.json(quote);
  } catch (error) {
    next(error);
  }
});

// Delete quote
quotesRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const oldQuote = await getQuoteById(id);
    await deleteQuote(id);
    await logAudit({ action: 'DELETE', entity: 'Quote', entityId: id, oldValue: { institutionName: oldQuote.institutionName, status: oldQuote.status, totalAmount: oldQuote.totalAmount }, req });
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
      const frontendUrl = process.env.FRONTEND_URL || 'https://crm.orma-ai.com';
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
              <p>הכנו עבורכם הצעת מחיר מותאמת אישית${(quote as any).videoPath ? ', כולל סרטון שיווקי קצר' : ''}.</p>
              <div style="text-align:center;margin:24px 0;">
                <a href="${publicUrl}" style="display:inline-block;background:#0891b2;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;">
                  ${(quote as any).videoPath ? '🎬 צפו בהצעה ובסרטון →' : 'צפו בהצעה המלאה →'}
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

    // Extract content from AI-generated text
    const contentStr = typeof quote.content === 'string' ? quote.content : JSON.stringify(quote.content || '');
    
    // Extract highlights: lines starting with - or * that look like bullet points
    const highlights: string[] = [];
    const lines = contentStr.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if ((trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) && trimmed.length > 10 && trimmed.length < 100) {
        highlights.push(trimmed.replace(/^[-*•]\s*\*?\*?/, '').replace(/\*\*$/,'').trim());
        if (highlights.length >= 4) break;
      }
    }

    // Extract about text (first paragraph after intro header)
    let aboutText = '';
    const aboutMatch = contentStr.match(/(?:מבוא|על דרך|אודות)[^\n]*\n+([^\n#]{30,200})/);
    if (aboutMatch) aboutText = aboutMatch[1].replace(/\*\*/g, '').trim();

    // Extract closing text
    let closingText = '';
    const closingMatch = contentStr.match(/(?:סיכום|לסיכום|נשמח)[^\n]*?([^.!?\n]{15,50}[.!?])/);
    if (closingMatch) closingText = closingMatch[1].replace(/\*\*/g, '').trim();

    const props = {
      institutionName: quote.institutionName,
      items: (quote.items || []).map((item: any) => ({
        courseName: item.courseName || 'שירות',
        type: (item.groups === 1 && item.meetingsPerGroup === 1 && item.description) ? 'project' : 'education',
        description: item.description || undefined,
      })),
      totalAmount: Number(quote.finalAmount || quote.totalAmount || 0),
      highlights: highlights.length > 0 ? highlights : [
        'צוות מדריכים מקצועי ומנוסה',
        'תוכניות מותאמות אישית',
        'ניסיון עשיר בחינוך טכנולוגי',
      ],
      aboutText: aboutText || 'דרך ההייטק מתמחה בהכשרות טכנולוגיות ו-AI לבתי ספר וארגונים',
      closingText: closingText || undefined,
    };

    setRenderStatus(id, 'rendering');
    renderQuoteVideo(id, props)
      .then(async () => {
        setRenderStatus(id, 'done');
        // Upload to Vimeo and save URL in DB
        await persistVideo(id, quote.institutionName);
      })
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
    
    // First check for persisted video (Vimeo or local)
    const videoPath = await getPersistedVideoPath(id);
    if (videoPath) {
      if (isVimeoUrl(videoPath)) {
        // Return Vimeo embed URL as JSON (frontend will use iframe/player)
        res.json({ status: 'done', vimeoUrl: videoPath });
        return;
      }
      // Local file fallback
      res.setHeader('Content-Type', 'video/mp4');
      const stream = fs.createReadStream(videoPath);
      stream.pipe(res);
      return;
    }

    // Fall back to render server
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
        // Upload to Vimeo for future requests
        persistVideo(id).catch(() => {});
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

// Delete video (from Vimeo and DB)
quotesRouter.delete('/:id/video', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { videoPath: true },
    });

    if (!quote?.videoPath) {
      return res.status(404).json({ message: 'אין סרטון להצעה זו' });
    }

    // Delete from Vimeo if it's a Vimeo URL
    if (isVimeoUrl(quote.videoPath)) {
      const videoId = quote.videoPath.split('/').pop();
      const vimeoToken = process.env.VIMEO_ACCESS_TOKEN;
      if (vimeoToken && videoId) {
        try {
          await fetch(`https://api.vimeo.com/videos/${videoId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `bearer ${vimeoToken}` },
          });
        } catch (err) {
          console.error('Failed to delete from Vimeo:', err);
        }
      }
    } else if (fs.existsSync(quote.videoPath)) {
      // Delete local file
      fs.unlinkSync(quote.videoPath);
    }

    // Clear videoPath in DB
    await prisma.quote.update({
      where: { id },
      data: { videoPath: null },
    });

    res.json({ message: 'הסרטון נמחק בהצלחה' });
  } catch (error) {
    next(error);
  }
});
