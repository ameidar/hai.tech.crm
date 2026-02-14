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
  convertToOrder,
} from '../services/quotes.service.js';

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
