import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export const inviteRouter = Router();

// Validate invite/reset token (public)
inviteRouter.get('/:token', async (req, res, next) => {
  try {
    const token = req.params.token;

    const instructor = await prisma.instructor.findUnique({
      where: { inviteToken: token },
      select: {
        id: true,
        name: true,
        email: true,
        inviteExpiresAt: true,
        userId: true,
      },
    });

    if (!instructor) {
      throw new AppError(404, 'Invalid or expired link');
    }

    if (instructor.inviteExpiresAt && new Date() > instructor.inviteExpiresAt) {
      throw new AppError(400, 'Link has expired');
    }

    // Determine if this is a new invite or password reset
    const isReset = !!instructor.userId;

    res.json({
      valid: true,
      type: isReset ? 'reset' : 'invite',
      instructor: {
        id: instructor.id,
        name: instructor.name,
        email: instructor.email,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Reset password using token (public)
inviteRouter.post('/:token/reset-password', async (req, res, next) => {
  try {
    const token = req.params.token;
    const { password } = req.body;

    if (!password || password.length < 6) {
      throw new AppError(400, 'Password must be at least 6 characters');
    }

    const instructor = await prisma.instructor.findUnique({
      where: { inviteToken: token },
      include: { user: true },
    });

    if (!instructor) {
      throw new AppError(404, 'Invalid or expired reset link');
    }

    if (!instructor.userId || !instructor.user) {
      throw new AppError(400, 'No user account found. Please use the invite link instead.');
    }

    if (instructor.inviteExpiresAt && new Date() > instructor.inviteExpiresAt) {
      throw new AppError(400, 'Reset link has expired');
    }

    // Hash new password and update user
    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: instructor.userId },
      data: { passwordHash },
    });

    // Clear the reset token
    await prisma.instructor.update({
      where: { id: instructor.id },
      data: {
        inviteToken: null,
        inviteExpiresAt: null,
      },
    });

    res.json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Setup password and create user account (public)
inviteRouter.post('/:token/setup', async (req, res, next) => {
  try {
    const token = req.params.token;
    const { password, email } = req.body;

    if (!password || password.length < 6) {
      throw new AppError(400, 'Password must be at least 6 characters');
    }

    const instructor = await prisma.instructor.findUnique({
      where: { inviteToken: token },
    });

    if (!instructor) {
      throw new AppError(404, 'Invalid or expired invite');
    }

    if (instructor.userId) {
      throw new AppError(400, 'Invite already used');
    }

    if (instructor.inviteExpiresAt && new Date() > instructor.inviteExpiresAt) {
      throw new AppError(400, 'Invite has expired');
    }

    // Use provided email or instructor's email
    const userEmail = email || instructor.email;
    if (!userEmail) {
      throw new AppError(400, 'Email is required');
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: userEmail },
    });

    if (existingUser) {
      throw new AppError(400, 'Email already in use');
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash,
        name: instructor.name,
        phone: instructor.phone,
        role: 'instructor',
      },
    });

    // Link user to instructor and clear invite token
    await prisma.instructor.update({
      where: { id: instructor.id },
      data: {
        userId: user.id,
        email: userEmail,
        inviteToken: null,
        inviteExpiresAt: null,
      },
    });

    res.json({
      success: true,
      message: 'Account created successfully',
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
