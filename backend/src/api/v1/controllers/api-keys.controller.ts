import { Response, NextFunction } from 'express';
import { apiKeysService } from '../services/api-keys.service.js';
import { createApiKeySchema, updateApiKeySchema, apiKeyQuerySchema, AVAILABLE_SCOPES } from '../validators/api-keys.js';
import { sendSuccess, sendCreated, sendList } from '../../../common/utils/response.js';
import { ValidationError, ForbiddenError } from '../../../common/errors/index.js';
import { AuthRequest } from '../middleware/auth.js';

/**
 * Get all API keys
 */
export async function listApiKeys(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Only admins can list API keys
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage API keys');
    }

    const parsed = apiKeyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors);
    }

    const { isActive, limit, offset } = parsed.data;

    const result = await apiKeysService.findAll(
      { isActive },
      { limit, offset }
    );

    return sendList(res, result.items, {
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get a single API key
 */
export async function getApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Only admins can view API keys
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage API keys');
    }

    const apiKey = await apiKeysService.findById(req.params.id);
    return sendSuccess(res, apiKey);
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new API key
 */
export async function createApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Only admins can create API keys
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage API keys');
    }

    const parsed = createApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid input', parsed.error.errors);
    }

    const apiKey = await apiKeysService.create(req.user.userId, parsed.data);

    // Return with warning message about key visibility
    return sendCreated(res, {
      ...apiKey,
      _warning: 'Store the key securely - it will not be shown again!'
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update an API key
 */
export async function updateApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Only admins can update API keys
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage API keys');
    }

    const parsed = updateApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid input', parsed.error.errors);
    }

    const apiKey = await apiKeysService.update(req.params.id, parsed.data);
    return sendSuccess(res, apiKey);
  } catch (error) {
    next(error);
  }
}

/**
 * Delete an API key
 */
export async function deleteApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Only admins can delete API keys
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage API keys');
    }

    await apiKeysService.delete(req.params.id);
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * Get available scopes
 */
export async function getAvailableScopes(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Only admins can view scopes
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can manage API keys');
    }

    return sendSuccess(res, {
      scopes: AVAILABLE_SCOPES,
      description: {
        '*': 'Full access to all resources',
        'read:*': 'Read access to all resources',
        'write:*': 'Write access to all resources',
        'read:customers': 'Read customer records',
        'write:customers': 'Create, update, delete customers',
        'read:students': 'Read student records',
        'write:students': 'Create, update, delete students',
        'read:courses': 'Read course definitions',
        'write:courses': 'Create, update, delete courses',
        'read:branches': 'Read branch information',
        'write:branches': 'Create, update, delete branches',
        'read:instructors': 'Read instructor profiles',
        'write:instructors': 'Create, update, delete instructors',
        'read:cycles': 'Read cycle/class information',
        'write:cycles': 'Create, update, delete cycles',
        'read:meetings': 'Read meeting schedules',
        'write:meetings': 'Create, update, delete meetings',
        'read:registrations': 'Read student registrations',
        'write:registrations': 'Create, update, delete registrations',
        'read:attendance': 'Read attendance records',
        'write:attendance': 'Record attendance',
        'read:reports': 'Access reports and analytics',
      },
    });
  } catch (error) {
    next(error);
  }
}
