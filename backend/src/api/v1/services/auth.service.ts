import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../../../config.js';
import { UnauthorizedError, NotFoundError } from '../../../common/errors/index.js';
import { authRepository, AuthRepository } from '../repositories/auth.repository.js';
import { LoginInput, RefreshTokenInput, ChangePasswordInput } from '../validators/auth.js';
import { UserRole } from '@prisma/client';

/**
 * JWT Payload structure
 */
export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  instructorId?: string;
}

/**
 * Auth response with tokens and user info
 */
export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    instructorId?: string;
  };
}

/**
 * User info response
 */
export interface UserInfo {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: UserRole;
  lastLogin: Date | null;
  createdAt: Date;
  instructorId?: string;
}

// JWT sign options
const accessTokenOptions: SignOptions = { expiresIn: '1d' };
const refreshTokenOptions: SignOptions = { expiresIn: '7d' };

/**
 * Auth Service - Business logic for authentication
 */
export class AuthService {
  constructor(private repository: AuthRepository) {}

  /**
   * Login with email and password
   */
  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.repository.findByEmail(input.email);

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const validPassword = await bcrypt.compare(input.password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Update last login
    await this.repository.updateLastLogin(user.id);

    // Create JWT payload
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      instructorId: user.instructor?.id,
    };

    // Generate tokens
    const accessToken = jwt.sign(payload, config.jwt.secret, accessTokenOptions);
    const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, refreshTokenOptions);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        instructorId: user.instructor?.id,
      },
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(input: RefreshTokenInput): Promise<{ accessToken: string }> {
    try {
      const decoded = jwt.verify(input.refreshToken, config.jwt.refreshSecret) as JwtPayload;

      const user = await this.repository.findById(decoded.userId);

      if (!user || !user.isActive) {
        throw new UnauthorizedError('Invalid refresh token');
      }

      // Create new access token
      const payload: JwtPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        instructorId: user.instructor?.id,
      };

      const accessToken = jwt.sign(payload, config.jwt.secret, accessTokenOptions);

      return { accessToken };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Invalid or expired refresh token');
      }
      throw error;
    }
  }

  /**
   * Get current user info
   */
  async getCurrentUser(userId: string): Promise<UserInfo> {
    const user = await this.repository.findById(userId);

    if (!user) {
      throw new NotFoundError('User');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      instructorId: user.instructor?.id,
    };
  }

  /**
   * Change user password
   */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.repository.findByEmail(
      (await this.repository.findById(userId))?.email || ''
    );

    if (!user) {
      throw new NotFoundError('User');
    }

    // Verify current password
    const validPassword = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // Hash and update new password
    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    await this.repository.updatePassword(userId, passwordHash);
  }
}

export const authService = new AuthService(authRepository);
