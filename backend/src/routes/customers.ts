import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createCustomerSchema, updateCustomerSchema, createStudentSchema, paginationSchema, uuidSchema } from '../types/schemas.js';
import { logAudit } from '../utils/audit.js';

export const customersRouter = Router();

// All routes require authentication
customersRouter.use(authenticate);

// List customers
customersRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const search = req.query.search as string | undefined;
    const city = req.query.city as string | undefined;
    const sortBy = req.query.sortBy as string | undefined; // 'lastPayment' | 'updatedAt' | undefined

    const where = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(city && { city }),
      // When sortBy=lastPayment, only return customers who have at least one paid payment
      ...(sortBy === 'lastPayment' && {
        payments: { some: { status: 'paid' } },
      }),
    };

    let customers: any[];
    let total: number;

    if (sortBy === 'lastPayment') {
      // Sort by most recent paid payment — use raw query for efficiency
      [customers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          include: {
            _count: { select: { students: true } },
            payments: {
              where: { status: 'paid' },
              orderBy: { paidAt: 'desc' },
              take: 1,
              select: { id: true, amount: true, description: true, paidAt: true },
            },
          },
          orderBy: {
            payments: {
              _count: 'desc', // fallback; actual sort below
            },
          },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.customer.count({ where }),
      ]);

      // Re-sort by actual latest payment date (Prisma doesn't support orderBy relation field directly)
      customers = customers.sort((a: any, b: any) => {
        const aDate = a.payments?.[0]?.paidAt ? new Date(a.payments[0].paidAt).getTime() : 0;
        const bDate = b.payments?.[0]?.paidAt ? new Date(b.payments[0].paidAt).getTime() : 0;
        return bDate - aDate;
      });
    } else {
      const orderBy = sortBy === 'updatedAt' ? { updatedAt: 'desc' as const } : { createdAt: 'desc' as const };
      [customers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          include: {
            _count: { select: { students: true } },
            payments: {
              where: { wooOrderId: { not: null }, status: 'paid' },
              select: { id: true },
              take: 1,
            },
          },
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.customer.count({ where }),
      ]);
    }

    const totalPages = Math.ceil(total / limit);
    res.json({
      data: customers,
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

// Get customer by ID
customersRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        students: {
          include: {
            registrations: {
              include: {
                cycle: {
                  include: {
                    course: true,
                    branch: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    res.json(customer);
  } catch (error) {
    next(error);
  }
});

// Create customer
customersRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const data = createCustomerSchema.parse(req.body);

    // Check if customer with this phone already exists
    const existingByPhone = await prisma.customer.findUnique({
      where: { phone: data.phone },
      include: {
        _count: { select: { students: true } },
        students: { select: { id: true, name: true } },
      },
    });

    if (existingByPhone) {
      throw new AppError(409, `לקוח עם מספר טלפון ${data.phone} כבר קיים: ${existingByPhone.name}`, {
        existingCustomer: existingByPhone,
      });
    }

    // Check if customer with this email already exists (only if email provided)
    if (data.email) {
      const existingByEmail = await prisma.customer.findUnique({
        where: { email: data.email },
        include: {
          _count: { select: { students: true } },
          students: { select: { id: true, name: true } },
        },
      });

      if (existingByEmail) {
        throw new AppError(409, `לקוח עם כתובת מייל ${data.email} כבר קיים: ${existingByEmail.name}`, {
          existingCustomer: existingByEmail,
        });
      }
    }

    const customer = await prisma.customer.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        address: data.address,
        city: data.city,
        notes: data.notes,
        source: data.source ?? 'manual',
      },
      include: {
        _count: { select: { students: true } },
      },
    });

    // Audit log
    await logAudit({
      userId: req.user?.userId,
      action: 'CREATE',
      entity: 'Customer',
      entityId: customer.id,
      newValue: { name: customer.name, phone: customer.phone, email: customer.email },
      req,
    });

    res.status(201).json(customer);
  } catch (error) {
    next(error);
  }
});

// Update customer
customersRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateCustomerSchema.parse(req.body);

    // Get old value for audit
    const oldCustomer = await prisma.customer.findUnique({ where: { id } });

    // Check duplicate phone (exclude current customer)
    if (data.phone) {
      const phoneConflict = await prisma.customer.findFirst({
        where: { phone: data.phone, id: { not: id } },
      });
      if (phoneConflict) {
        throw new AppError(409, `לקוח עם מספר טלפון ${data.phone} כבר קיים: ${phoneConflict.name}`, {
          existingCustomer: phoneConflict,
        });
      }
    }

    // Check duplicate email (exclude current customer)
    if (data.email) {
      const emailConflict = await prisma.customer.findFirst({
        where: { email: data.email, id: { not: id } },
      });
      if (emailConflict) {
        throw new AppError(409, `לקוח עם כתובת מייל ${data.email} כבר קיים: ${emailConflict.name}`, {
          existingCustomer: emailConflict,
        });
      }
    }

    const customer = await prisma.customer.update({
      where: { id },
      data,
      include: {
        _count: { select: { students: true } },
      },
    });

    // Audit log
    await logAudit({
      userId: req.user?.userId,
      action: 'UPDATE',
      entity: 'Customer',
      entityId: customer.id,
      oldValue: oldCustomer ? { name: oldCustomer.name, phone: oldCustomer.phone, email: oldCustomer.email } : undefined,
      newValue: { name: customer.name, phone: customer.phone, email: customer.email },
      req,
    });

    res.json(customer);
  } catch (error) {
    next(error);
  }
});

// Delete customer
customersRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    // Get old value for audit
    const oldCustomer = await prisma.customer.findUnique({ where: { id } });

    await prisma.customer.delete({
      where: { id },
    });

    // Audit log
    if (oldCustomer) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Customer',
        entityId: id,
        oldValue: { name: oldCustomer.name, phone: oldCustomer.phone, email: oldCustomer.email },
        req,
      });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Get customer's students
customersRouter.get('/:id/students', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const students = await prisma.student.findMany({
      where: { customerId: id },
      include: {
        registrations: {
          include: {
            cycle: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
        },
      },
    });

    res.json(students);
  } catch (error) {
    next(error);
  }
});

// Create student for customer
customersRouter.post('/:id/students', managerOrAdmin, async (req, res, next) => {
  try {
    const customerId = uuidSchema.parse(req.params.id);
    
    // Verify customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    
    if (!customer) {
      throw new AppError(404, 'Customer not found');
    }

    const data = createStudentSchema.omit({ customerId: true }).parse(req.body);

    const student = await prisma.student.create({
      data: {
        name: data.name,
        birthDate: data.birthDate ? new Date(data.birthDate) : null,
        grade: data.grade,
        notes: data.notes,
        customerId,
      },
      include: {
        customer: {
          select: { id: true, name: true },
        },
      },
    });

    res.status(201).json(student);
  } catch (error) {
    next(error);
  }
});
