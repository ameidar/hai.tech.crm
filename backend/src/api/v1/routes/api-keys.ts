import { Router } from 'express';
import {
  listApiKeys,
  getApiKey,
  createApiKey,
  updateApiKey,
  deleteApiKey,
  getAvailableScopes,
} from '../controllers/api-keys.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/v1/api-keys
 * @desc    List all API keys (admin only)
 * @access  Private (admin)
 */
router.get('/', listApiKeys);

/**
 * @route   GET /api/v1/api-keys/scopes
 * @desc    Get available scopes
 * @access  Private (admin)
 */
router.get('/scopes', getAvailableScopes);

/**
 * @route   GET /api/v1/api-keys/:id
 * @desc    Get a single API key
 * @access  Private (admin)
 */
router.get('/:id', getApiKey);

/**
 * @route   POST /api/v1/api-keys
 * @desc    Create a new API key
 * @access  Private (admin)
 */
router.post('/', createApiKey);

/**
 * @route   PUT /api/v1/api-keys/:id
 * @desc    Update an API key
 * @access  Private (admin)
 */
router.put('/:id', updateApiKey);

/**
 * @route   DELETE /api/v1/api-keys/:id
 * @desc    Delete an API key
 * @access  Private (admin)
 */
router.delete('/:id', deleteApiKey);

export default router;
