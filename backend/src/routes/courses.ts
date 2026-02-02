import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createCourseSchema, updateCourseSchema, paginationSchema, uuidSchema } from '../types/schemas.js';

export const coursesRouter = Router();

coursesRouter.use(authenticate);

// List courses
coursesRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const category = req.query.category as string | undefined;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    const where = {
      ...(category && { category: category as any }),
      ...(isActive !== undefined && { isActive }),
    };

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        include: {
          _count: { select: { cycles: true } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.course.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({
      data: courses,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get course by ID
coursesRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        cycles: {
          where: { status: 'active' },
          include: {
            branch: { select: { id: true, name: true } },
            instructor: { select: { id: true, name: true } },
            _count: { select: { registrations: true } },
          },
        },
      },
    });

    if (!course) {
      throw new AppError(404, 'Course not found');
    }

    res.json(course);
  } catch (error) {
    next(error);
  }
});

// Create course
coursesRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const data = createCourseSchema.parse(req.body);

    const course = await prisma.course.create({
      data,
    });

    res.status(201).json(course);
  } catch (error) {
    next(error);
  }
});

// Update course
coursesRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateCourseSchema.parse(req.body);

    const course = await prisma.course.update({
      where: { id },
      data,
    });

    res.json(course);
  } catch (error) {
    next(error);
  }
});

// Delete course
coursesRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    // Check if course has active cycles
    const activeCycles = await prisma.cycle.count({
      where: { courseId: id, status: 'active' },
    });

    if (activeCycles > 0) {
      throw new AppError(400, 'Cannot delete course with active cycles');
    }

    await prisma.course.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
