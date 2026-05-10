import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import multer from 'multer';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public data?: Record<string, any>,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error('Error:', err);

  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // App errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      message: err.message,
      ...(err.data && { data: err.data }),
    });
  }

  // Multer upload errors
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'הקובץ גדול מדי. ניתן להעלות קבצים עד 20MB'
      : `שגיאה בהעלאת הקובץ: ${err.message}`;
    return res.status(400).json({ error: message, message });
  }

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'A record with this value already exists',
        message: 'A record with this value already exists',
        field: (err.meta?.target as string[])?.join(', '),
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        error: 'Record not found',
        message: 'Record not found',
      });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({
        error: 'Foreign key constraint violation',
        message: 'Foreign key constraint violation',
      });
    }
  }

  // Default error
  return res.status(500).json({
    error: 'Internal server error',
    message: 'Internal server error',
  });
};
