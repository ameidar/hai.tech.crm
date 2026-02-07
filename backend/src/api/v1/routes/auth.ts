import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { loginSchema, refreshTokenSchema, changePasswordSchema } from '../validators/auth.js';

const router = Router();

/**
 * POST /auth/login
 * Login with email and password
 */
router.post('/login', validateBody(loginSchema), (req, res, next) => {
  authController.login(req, res, next);
});

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', validateBody(refreshTokenSchema), (req, res, next) => {
  authController.refreshToken(req, res, next);
});

/**
 * GET /auth/me
 * Get current user info (protected)
 */
router.get('/me', authenticate, (req, res, next) => {
  authController.getCurrentUser(req, res, next);
});

/**
 * POST /auth/logout
 * Logout (protected, mostly for audit purposes)
 */
router.post('/logout', authenticate, (req, res) => {
  authController.logout(req, res);
});

/**
 * PUT /auth/password
 * Change password (protected)
 */
router.put('/password', authenticate, validateBody(changePasswordSchema), (req, res, next) => {
  authController.changePassword(req, res, next);
});

export { router as authRouter };
