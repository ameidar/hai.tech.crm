import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { buildOrderPreview } from '../services/quotes.service.js';
import {
  orderSchema,
  createOrderSchema,
  listInstitutionalOrders,
  getInstitutionalOrder,
  createInstitutionalOrder,
  updateInstitutionalOrder,
  type InstitutionalOrderListQuery,
} from '../services/institutional-orders.service.js';

// pdf-parse ships as CommonJS; its index.js runs debug code when it is the entry module,
// so we load the library file directly. No bundled types, hence the require + cast.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buffer: Buffer) => Promise<{ text: string }>;

const uploadQuotePdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const QUOTE_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const institutionalOrdersRouter = Router();

institutionalOrdersRouter.use(authenticate);

// Import a CRM-generated quote PDF and preview the order it would create.
// The generated PDF embeds the quote's public URL (/public/quote/<uuid>) on every page,
// so we extract that UUID and load the real quote record — no AI guessing, full accuracy.
institutionalOrdersRouter.post(
  '/import-quote',
  managerOrAdmin,
  uploadQuotePdf.single('file'),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        throw new AppError(400, 'לא צורף קובץ.');
      }
      if (file.mimetype !== 'application/pdf') {
        throw new AppError(400, 'יש להעלות קובץ PDF של הצעת מחיר שיוצאה מהמערכת.');
      }

      let text = '';
      try {
        const parsed = await pdfParse(file.buffer);
        text = parsed.text || '';
      } catch (err) {
        console.error('[import-quote] PDF parse failed:', err);
        throw new AppError(422, 'קריאת ה-PDF נכשלה. ודא שזהו קובץ PDF תקין.');
      }

      const urlMatch = text.match(/public\/quote\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      const uuid = urlMatch?.[1] ?? text.match(QUOTE_UUID_RE)?.[0] ?? null;

      if (!uuid) {
        throw new AppError(
          422,
          'לא זוהתה הצעת מחיר בקובץ. ודא שמדובר ב-PDF של הצעת מחיר שיוצאה מ-CRM (מכיל קישור ציבורי להצעה).'
        );
      }

      let preview;
      try {
        preview = await buildOrderPreview(uuid);
      } catch (err) {
        if (err instanceof AppError && err.statusCode === 404) {
          throw new AppError(404, 'ההצעה זוהתה בקובץ אך לא נמצאה במערכת (ייתכן שנמחקה).');
        }
        throw err;
      }

      res.json({ quoteId: uuid, ...preview });
    } catch (error) {
      next(error);
    }
  }
);

// List all institutional orders with branch info
institutionalOrdersRouter.get('/', async (req, res, next) => {
  try {
    res.json(await listInstitutionalOrders(req.query as InstitutionalOrderListQuery));
  } catch (error) {
    next(error);
  }
});

// Get single institutional order
institutionalOrdersRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await getInstitutionalOrder(req.params.id));
  } catch (error) {
    next(error);
  }
});

// Schemas live in the shared service; re-exported for existing importers/tests.
export { orderSchema, createOrderSchema };

// Create institutional order
institutionalOrdersRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const order = await createInstitutionalOrder(req.body, req);
    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

// Update institutional order
institutionalOrdersRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const order = await updateInstitutionalOrder(req.params.id, req.body, req);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Delete institutional order
institutionalOrdersRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.institutionalOrder.findUnique({
      where: { id },
      include: { _count: { select: { cycles: true } } },
    });
    if (!existing) throw new AppError(404, 'Institutional order not found');
    if (existing._count.cycles > 0) {
      throw new AppError(400, 'Cannot delete institutional order with associated cycles');
    }
    await prisma.institutionalOrder.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
