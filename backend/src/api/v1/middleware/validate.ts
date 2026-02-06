import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { sendError } from '../../../common/utils/response.js';

/**
 * Format Zod errors into a consistent structure
 */
function formatZodErrors(error: ZodError) {
  return error.errors.map((e) => ({
    field: e.path.join('.'),
    message: e.message,
    code: e.code,
  }));
}

/**
 * Validation target - which part of the request to validate
 */
type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Validation configuration
 */
interface ValidationConfig {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Validate request body, query params, or route params
 * 
 * Usage:
 * ```ts
 * // Validate body only
 * router.post('/users', validate(createUserSchema), createUser);
 * 
 * // Validate with specific targets
 * router.put('/users/:id', 
 *   validate({ body: updateUserSchema, params: idParamSchema }), 
 *   updateUser
 * );
 * ```
 */
export function validate(
  schemaOrConfig: ZodSchema | ValidationConfig,
  target: ValidationTarget = 'body'
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Handle simple schema (body only)
      if ('parse' in schemaOrConfig) {
        const schema = schemaOrConfig as ZodSchema;
        const validated = schema.parse(req[target]);
        req[target] = validated;
        next();
        return;
      }
      
      // Handle config object with multiple targets
      const config = schemaOrConfig as ValidationConfig;
      
      if (config.body) {
        req.body = config.body.parse(req.body);
      }
      
      if (config.query) {
        req.query = config.query.parse(req.query);
      }
      
      if (config.params) {
        req.params = config.params.parse(req.params);
      }
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Invalid input', formatZodErrors(error));
        return;
      }
      next(error);
    }
  };
}

/**
 * Shorthand validators for common use cases
 */
export const validateBody = (schema: ZodSchema) => validate(schema, 'body');
export const validateQuery = (schema: ZodSchema) => validate(schema, 'query');
export const validateParams = (schema: ZodSchema) => validate(schema, 'params');
