import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { authenticate, adminOnly } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { z } from 'zod';
import { logAudit } from '../utils/audit.js';

export const systemUsersRouter = Router();

systemUsersRouter.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email('Invalid email'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional().nullable(),
  role: z.enum(['admin', 'manager']),
  password: z.string().min(6).optional(), // optional — auto-generated if not provided
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional().nullable(),
  role: z.enum(['admin', 'manager']).optional(),
  isActive: z.boolean().optional(),
});

// List system users (admin + manager)
systemUsersRouter.get('/', adminOnly, async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        role: { in: ['admin', 'manager'] },
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(users);
  } catch (error) {
    next(error);
  }
});

// Create system user (admin only)
systemUsersRouter.post('/', adminOnly, async (req, res, next) => {
  try {
    const data = createUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new AppError(409, 'Email already registered');
    }

    // Use provided password or generate a random one
    const plainPassword = data.password || crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    // Generate invite token (valid 7 days)
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        phone: data.phone,
        role: data.role,
        passwordHash,
        resetToken: inviteToken,
        resetTokenExpiry: inviteExpiry,
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    const envUrl = process.env.FRONTEND_URL;
    const baseUrl = (envUrl && envUrl !== '*') ? envUrl : 'https://crm.orma-ai.com';
    const inviteUrl = `${baseUrl}/reset-password/${inviteToken}`;

    await logAudit({ req, action: 'CREATE', entity: 'SystemUser', entityId: user.id, newValue: { email: user.email, role: user.role } });

    res.status(201).json({ ...user, inviteUrl });
  } catch (error) {
    next(error);
  }
});

// Update system user (admin only)
systemUsersRouter.put('/:id', adminOnly, async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = updateUserSchema.parse(req.body);

    // Don't allow admin to deactivate themselves
    if (data.isActive === false && id === req.user!.userId) {
      throw new AppError(400, 'You cannot deactivate your own account');
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing || !['admin', 'manager'].includes(existing.role)) {
      throw new AppError(404, 'User not found');
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
      },
    });

    await logAudit({ req, action: 'UPDATE', entity: 'SystemUser', entityId: user.id, oldValue: existing, newValue: data });

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// Reset password for system user — generates a reset URL (admin only)
systemUsersRouter.post('/:id/reset-password', adminOnly, async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing || !['admin', 'manager'].includes(existing.role)) {
      throw new AppError(404, 'User not found');
    }

    // Generate reset token (valid 24h)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id },
      data: { resetToken, resetTokenExpiry },
    });

    const envUrl = process.env.FRONTEND_URL;
    const baseUrl = (envUrl && envUrl !== '*') ? envUrl : 'https://crm.orma-ai.com';
    const resetUrl = `${baseUrl}/reset-password/${resetToken}`;

    await logAudit({ req, action: 'UPDATE', entity: 'SystemUser', entityId: id, newValue: { action: 'reset_password', email: existing.email } });

    res.json({
      success: true,
      resetUrl,
      expiresAt: resetTokenExpiry,
      user: {
        id: existing.id,
        name: existing.name,
        email: existing.email,
        phone: existing.phone,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Delete system user (admin only)
systemUsersRouter.delete('/:id', adminOnly, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (id === req.user!.userId) {
      throw new AppError(400, 'You cannot delete your own account');
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing || !['admin', 'manager'].includes(existing.role)) {
      throw new AppError(404, 'User not found');
    }

    await prisma.user.delete({ where: { id } });

    await logAudit({ req, action: 'DELETE', entity: 'SystemUser', entityId: id, oldValue: existing });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
