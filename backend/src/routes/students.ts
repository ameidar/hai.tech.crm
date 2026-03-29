import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createStudentSchema, updateStudentSchema, paginationSchema, uuidSchema } from '../types/schemas.js';
import { logAudit, logUpdateAudit } from '../utils/audit.js';

export const studentsRouter = Router();

studentsRouter.use(authenticate);

// List students
studentsRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const search = req.query.search as string | undefined;
    const customerId = req.query.customerId as string | undefined;

    const where = {
      ...(search && {
        name: { contains: search, mode: 'insensitive' as const },
      }),
      ...(customerId && { customerId }),
    };

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, phone: true },
          },
          registrations: {
            where: { status: { in: ['registered', 'active'] } },
            include: {
              cycle: {
                select: {
                  id: true,
                  name: true,
                  course: { select: { id: true, name: true } },
                  branch: { select: { id: true, name: true } },
                },
              },
            },
          },
          _count: { select: { registrations: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.student.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({
      data: students,
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

// Get student by ID
studentsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        customer: true,
        registrations: {
          include: {
            cycle: {
              include: {
                course: true,
                branch: true,
                instructor: { select: { id: true, name: true } },
              },
            },
            attendance: {
              orderBy: { recordedAt: 'desc' },
              take: 10,
            },
          },
        },
      },
    });

    if (!student) {
      throw new AppError(404, 'Student not found');
    }

    res.json(student);
  } catch (error) {
    next(error);
  }
});

// Create student
studentsRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const data = createStudentSchema.parse(req.body);

    // Verify customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
    });

    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    const student = await prisma.student.create({
      data: {
        customerId: data.customerId,
        name: data.name,
        birthDate: data.birthDate ? new Date(data.birthDate) : null,
        grade: data.grade,
        notes: data.notes,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    await logAudit({ action: 'CREATE', entity: 'Student', entityId: student.id, newValue: { name: student.name, customerId: student.customerId, grade: student.grade }, req });

    res.status(201).json(student);
  } catch (error) {
    next(error);
  }
});

// Update student
studentsRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateStudentSchema.parse(req.body);

    const oldStudent = await prisma.student.findUnique({ where: { id } });

    const student = await prisma.student.update({
      where: { id },
      data: {
        ...data,
        birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    if (oldStudent) {
      await logUpdateAudit({ entity: 'Student', entityId: id, oldRecord: oldStudent, newRecord: student, req });
    }

    res.json(student);
  } catch (error) {
    next(error);
  }
});

// Delete student
studentsRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const oldStudent = await prisma.student.findUnique({ where: { id } });

    await prisma.student.delete({
      where: { id },
    });

    if (oldStudent) {
      await logAudit({ action: 'DELETE', entity: 'Student', entityId: id, oldValue: { name: oldStudent.name, customerId: oldStudent.customerId }, req });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
