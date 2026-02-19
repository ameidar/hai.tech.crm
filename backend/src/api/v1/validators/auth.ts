import { z } from 'zod';
import { emailSchema, nonEmptyStringSchema } from './common.js';

/**
 * Login request schema
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: nonEmptyStringSchema,
});

/**
 * Refresh token request schema
 */
export const refreshTokenSchema = z.object({
  refreshToken: nonEmptyStringSchema,
});

/**
 * Change password request schema
 */
export const changePasswordSchema = z.object({
  currentPassword: nonEmptyStringSchema,
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

// Export types
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
