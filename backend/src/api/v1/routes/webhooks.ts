import { Router } from 'express';
import {
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  getDeliveries,
  getAvailableEvents,
} from '../controllers/webhooks.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/v1/webhooks
 * @desc    List all webhooks
 * @access  Private (admin)
 */
router.get('/', listWebhooks);

/**
 * @route   GET /api/v1/webhooks/events
 * @desc    Get available webhook events
 * @access  Private (admin)
 */
router.get('/events', getAvailableEvents);

/**
 * @route   GET /api/v1/webhooks/deliveries
 * @desc    Get webhook delivery history
 * @access  Private (admin)
 */
router.get('/deliveries', getDeliveries);

/**
 * @route   GET /api/v1/webhooks/:id
 * @desc    Get a single webhook (includes secret)
 * @access  Private (admin)
 */
router.get('/:id', getWebhook);

/**
 * @route   POST /api/v1/webhooks
 * @desc    Create a new webhook
 * @access  Private (admin)
 */
router.post('/', createWebhook);

/**
 * @route   POST /api/v1/webhooks/:id/test
 * @desc    Test a webhook by sending a test payload
 * @access  Private (admin)
 */
router.post('/:id/test', testWebhook);

/**
 * @route   PUT /api/v1/webhooks/:id
 * @desc    Update a webhook
 * @access  Private (admin)
 */
router.put('/:id', updateWebhook);

/**
 * @route   DELETE /api/v1/webhooks/:id
 * @desc    Delete a webhook
 * @access  Private (admin)
 */
router.delete('/:id', deleteWebhook);

export default router;
