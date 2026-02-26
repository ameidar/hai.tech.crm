import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config.js';

export const filesRouter = Router();

// Supported entity types
const ALLOWED_ENTITY_TYPES = ['instructor', 'quote'];

// Upload directory
const UPLOADS_BASE = path.join(process.cwd(), 'uploads');

// Ensure upload directories exist
const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const entityType = req.params.entityType || req.body.entityType || 'misc';
    const entityId = req.params.entityId || req.body.entityId || 'unknown';
    const dir = path.join(UPLOADS_BASE, entityType, entityId);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Allow common document types
  const allowedMimes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'text/plain',
    'application/zip',
    'application/x-rar-compressed',
  ];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(400, `סוג קובץ לא נתמך: ${file.mimetype}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// POST /api/files/:entityType/:entityId — upload a file
filesRouter.post('/:entityType/:entityId', authenticate, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { entityType, entityId } = req.params;
    const { label } = req.body;

    if (!ALLOWED_ENTITY_TYPES.includes(entityType)) {
      throw new AppError(400, `entityType לא חוקי: ${entityType}`);
    }

    if (!req.file) {
      throw new AppError(400, 'לא הועלה קובץ');
    }

    // Verify entity exists
    if (entityType === 'instructor') {
      const instructor = await prisma.instructor.findUnique({ where: { id: entityId } });
      if (!instructor) throw new AppError(404, 'מדריך לא נמצא');
    } else if (entityType === 'quote') {
      const quote = await prisma.quote.findUnique({ where: { id: entityId } });
      if (!quote) throw new AppError(404, 'הצעת מחיר לא נמצאה');
    }

    const filePath = `${entityType}/${entityId}/${req.file.filename}`;
    // Fix Hebrew/Unicode filenames: multer delivers originalname as latin1, convert to utf-8
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const attachment = await prisma.fileAttachment.create({
      data: {
        entityType,
        entityId,
        fileName: req.file.filename,
        originalName,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        filePath,
        label: label || null,
        uploadedById: req.user?.userId || null,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(attachment);
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    next(error);
  }
});

// GET /api/files/download/:id — download a file (MUST be before /:entityType/:entityId)
// Auth: Bearer header OR ?token= query param (for direct browser links)
filesRouter.get('/download/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Allow token via query param for direct browser download links
    if (req.query.token) {
      try {
        const decoded = jwt.verify(req.query.token as string, config.jwt.secret) as any;
        (req as any).user = decoded;
      } catch {
        throw new AppError(401, 'טוקן לא תקין');
      }
    } else if (!req.user) {
      // Try Authorization header via authenticate manually
      throw new AppError(401, 'נדרשת התחברות');
    }

    const attachment = await prisma.fileAttachment.findUnique({
      where: { id: req.params.id },
    });

    if (!attachment) throw new AppError(404, 'קובץ לא נמצא');

    const fullPath = path.join(UPLOADS_BASE, attachment.filePath);

    if (!fs.existsSync(fullPath)) {
      throw new AppError(404, 'קובץ לא נמצא בדיסק');
    }

    // Use RFC 5987 encoded filename for proper Unicode support across browsers
    const encodedName = encodeURIComponent(attachment.originalName).replace(/'/g, '%27');
    // res.download sends the file with proper Content-Disposition header
    res.download(fullPath, attachment.originalName, (err) => {
      if (err) {
        console.error('File download error:', err);
        if (!res.headersSent) {
          next(new AppError(500, `שגיאה בשליחת הקובץ: ${(err as any).message}`));
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/files/:entityType/:entityId — list files for entity
filesRouter.get('/:entityType/:entityId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { entityType, entityId } = req.params;

    if (!ALLOWED_ENTITY_TYPES.includes(entityType)) {
      throw new AppError(400, `entityType לא חוקי: ${entityType}`);
    }

    const attachments = await prisma.fileAttachment.findMany({
      where: { entityType, entityId },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(attachments);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/files/:id — delete a file
filesRouter.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only admin/manager can delete
    if (req.user?.role === 'instructor') {
      throw new AppError(403, 'אין הרשאה למחוק קבצים');
    }

    const attachment = await prisma.fileAttachment.findUnique({
      where: { id: req.params.id },
    });

    if (!attachment) throw new AppError(404, 'קובץ לא נמצא');

    // Delete from disk
    const fullPath = path.join(UPLOADS_BASE, attachment.filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    // Delete from DB
    await prisma.fileAttachment.delete({ where: { id: req.params.id } });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/files/:id — update label
filesRouter.patch('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { label } = req.body;

    const attachment = await prisma.fileAttachment.update({
      where: { id: req.params.id },
      data: { label },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });

    res.json(attachment);
  } catch (error) {
    next(error);
  }
});
