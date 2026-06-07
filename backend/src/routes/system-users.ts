import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { authenticate, adminOnly, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { z } from 'zod';
import { logAudit } from '../utils/audit.js';

export const systemUsersRouter = Router();

systemUsersRouter.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email('Invalid email').transform(v => v.trim().toLowerCase()),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional().nullable(),
  role: z.enum(['admin', 'manager', 'sales', 'operations']),
  password: z.string().min(6).optional(), // optional — auto-generated if not provided
  // Operations-staff config (creates a linked Instructor record)
  hourlyRate: z.number().nonnegative().optional().nullable(),
  city: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankBranch: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional().nullable(),
  role: z.enum(['admin', 'manager', 'sales', 'operations']).optional(),
  isActive: z.boolean().optional(),
  hourlyRate: z.number().nonnegative().optional().nullable(),
  city: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankBranch: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
});

const MANAGED_ROLES = ['admin', 'manager', 'sales', 'operations'] as const;

// List system users (admin + manager)
systemUsersRouter.get('/', adminOnly, async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        role: { in: [...MANAGED_ROLES] },
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
        instructor: {
          select: {
            id: true,
            hourlyRate: true,
            city: true,
            bankName: true,
            bankBranch: true,
            accountNumber: true,
          },
        },
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

    // Operations staff are backed by an Instructor record (kind='operations'),
    // which requires a unique phone number.
    if (data.role === 'operations') {
      if (!data.phone || !data.phone.trim()) {
        throw new AppError(400, 'Phone is required for operations staff');
      }
      const phoneTaken = await prisma.instructor.findUnique({ where: { phone: data.phone.trim() } });
      if (phoneTaken) {
        throw new AppError(409, 'Phone already registered to another instructor');
      }
    }

    // Use provided password or generate a random one
    const plainPassword = data.password || crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    // Generate invite token (valid 7 days)
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
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

      if (data.role === 'operations') {
        await tx.instructor.create({
          data: {
            userId: created.id,
            kind: 'operations',
            name: data.name,
            phone: data.phone!.trim(),
            email: data.email,
            city: data.city ?? null,
            hourlyRate: data.hourlyRate ?? 50,
            bankName: data.bankName ?? null,
            bankBranch: data.bankBranch ?? null,
            accountNumber: data.accountNumber ?? null,
          },
        });
      }

      return created;
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

    const existing = await prisma.user.findUnique({ where: { id }, include: { instructor: true } });
    if (!existing || !MANAGED_ROLES.includes(existing.role as typeof MANAGED_ROLES[number])) {
      throw new AppError(404, 'User not found');
    }

    const { hourlyRate, city, bankName, bankBranch, accountNumber, ...userData } = data;

    // Promoting an existing managed user (e.g. manager/sales) to operations needs a
    // linked Instructor record created — which requires a unique phone.
    const needsNewOpsInstructor = data.role === 'operations' && !existing.instructor;
    const opsPhone = (userData.phone ?? existing.phone ?? '').trim();
    if (needsNewOpsInstructor) {
      if (!opsPhone) {
        throw new AppError(400, 'Phone is required for operations staff');
      }
      const phoneTaken = await prisma.instructor.findFirst({
        where: { phone: opsPhone, NOT: { userId: id } },
      });
      if (phoneTaken) {
        throw new AppError(409, 'Phone already registered to another instructor');
      }
    }

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: userData,
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

      if (existing.instructor && existing.instructor.kind === 'operations') {
        // Keep the linked operations Instructor in sync
        await tx.instructor.update({
          where: { id: existing.instructor.id },
          data: {
            ...(userData.name !== undefined && { name: userData.name }),
            ...(userData.phone !== undefined && userData.phone && { phone: userData.phone }),
            ...(city !== undefined && { city }),
            ...(hourlyRate !== undefined && { hourlyRate }),
            ...(bankName !== undefined && { bankName }),
            ...(bankBranch !== undefined && { bankBranch }),
            ...(accountNumber !== undefined && { accountNumber }),
            ...(userData.isActive !== undefined && { isActive: userData.isActive }),
          },
        });
      } else if (needsNewOpsInstructor) {
        // Create the linked operations Instructor for a user that didn't have one
        await tx.instructor.create({
          data: {
            userId: id,
            kind: 'operations',
            name: userData.name ?? existing.name,
            phone: opsPhone,
            email: existing.email,
            city: city ?? null,
            hourlyRate: hourlyRate ?? 50,
            bankName: bankName ?? null,
            bankBranch: bankBranch ?? null,
            accountNumber: accountNumber ?? null,
            ...(userData.isActive !== undefined && { isActive: userData.isActive }),
          },
        });
      }

      return updated;
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
    if (!existing || !MANAGED_ROLES.includes(existing.role as typeof MANAGED_ROLES[number])) {
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

    const existing = await prisma.user.findUnique({ where: { id }, include: { instructor: true } });
    if (!existing || !MANAGED_ROLES.includes(existing.role as typeof MANAGED_ROLES[number])) {
      throw new AppError(404, 'User not found');
    }

    await prisma.$transaction(async (tx) => {
      // Remove the linked operations Instructor (and its work-hour entries via cascade)
      if (existing.instructor && existing.instructor.kind === 'operations') {
        await tx.instructor.delete({ where: { id: existing.instructor.id } });
      }
      await tx.user.delete({ where: { id } });
    });

    await logAudit({ req, action: 'DELETE', entity: 'SystemUser', entityId: id, oldValue: existing });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/system-users/online — who's currently active (last 5 min)
systemUsersRouter.get('/online', managerOrAdmin, async (_req, res, next) => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const onlineUsers = await prisma.user.findMany({
      where: {
        lastActive: { gte: fiveMinutesAgo },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        lastActive: true,
      },
      orderBy: { lastActive: 'desc' },
    });
    res.json({ onlineUsers, count: onlineUsers.length });
  } catch (error) {
    next(error);
  }
});
