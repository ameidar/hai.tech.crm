import { Router } from 'express';
import { uuidSchema } from '../types/schemas.js';
import { getQuoteById } from '../services/quotes.service.js';

export const publicQuoteRouter = Router();

// GET /api/public/quotes/:id — public, no auth
publicQuoteRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const quote = await getQuoteById(id);

    if (!quote) {
      return res.status(404).json({ error: 'הצעה לא נמצאה' });
    }

    // Only allow public access to sent/accepted/converted quotes
    const allowedStatuses = ['sent', 'accepted', 'converted'];
    if (!allowedStatuses.includes(quote.status)) {
      return res.status(404).json({ error: 'הצעה לא נמצאה' });
    }

    res.json(quote);
  } catch (error) {
    next(error);
  }
});
