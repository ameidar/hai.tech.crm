import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { LoginInput, RefreshTokenInput, ChangePasswordInput } from '../validators/auth.js';
import { sendSuccess } from '../../../common/utils/response.js';

/**
 * Auth Controller - Request handlers for authentication
 */
export class AuthController {
  /**
   * POST /auth/login - Login with email and password
   */
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const input = req.body as LoginInput;
      const result = await authService.login(input);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /auth/refresh - Refresh access token
   */
  async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const input = req.body as RefreshTokenInput;
      const result = await authService.refreshToken(input);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /auth/me - Get current user info
   */
  async getCurrentUser(_req: Request, res: Response, next: NextFunction) {
    try {
      const userId = res.locals.userId;
      const user = await authService.getCurrentUser(userId);
      sendSuccess(res, user);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /auth/logout - Logout (acknowledge only, token invalidation is client-side)
   */
  logout(_req: Request, res: Response) {
    sendSuccess(res, { message: 'Logged out successfully' });
  }

  /**
   * PUT /auth/password - Change password
   */
  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = res.locals.userId;
      const input = req.body as ChangePasswordInput;
      await authService.changePassword(userId, input);
      sendSuccess(res, { message: 'Password changed successfully' });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
