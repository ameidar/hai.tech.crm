import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../utils/prisma.js';
import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, JwtPayload } from '../middleware/auth.js';
import { loginSchema, registerSchema } from '../types/schemas.js';

// JWT sign options
const accessTokenOptions: SignOptions = { expiresIn: '1d' };
const refreshTokenOptions: SignOptions = { expiresIn: '7d' };

export const authRouter = Router();

// Login
authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, 'Invalid credentials');
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      throw new AppError(401, 'Invalid credentials');
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    const accessToken = jwt.sign(payload, config.jwt.secret, accessTokenOptions);

    const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, refreshTokenOptions);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Register - admin only (requires authentication + admin role)
authRouter.post('/register', authenticate, async (req, res, next) => {
  try {
    // Check admin role
    if (req.user!.role !== 'admin') {
      throw new AppError(403, 'Only administrators can register new users');
    }

    const data = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new AppError(409, 'Email already registered');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
        phone: data.phone,
        role: data.role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

// Refresh token
authRouter.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError(400, 'Refresh token required');
    }

    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as JwtPayload;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, 'Invalid refresh token');
    }

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    const newAccessToken = jwt.sign(payload, config.jwt.secret, accessTokenOptions);

    res.json({ accessToken: newAccessToken });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError(401, 'Invalid refresh token'));
    }
    next(error);
  }
});

// Get current user
authRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        lastLogin: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// Logout (client-side, just acknowledge)
authRouter.post('/logout', authenticate, (_req, res) => {
  res.json({ message: 'Logged out successfully' });
});
