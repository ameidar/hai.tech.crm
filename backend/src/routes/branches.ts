import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { 
  createBranchSchema, 
  updateBranchSchema, 
  createInstitutionalOrderSchema,
  updateInstitutionalOrderSchema,
  paginationSchema, 
  uuidSchema 
} from '../types/schemas.js';

export const branchesRouter = Router();

branchesRouter.use(authenticate);

// List branches
branchesRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const type = req.query.type as string | undefined;
    const city = req.query.city as string | undefined;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    const where = {
      ...(type && { type: type as any }),
      ...(city && { city }),
      ...(isActive !== undefined && { isActive }),
    };

    const [branches, total] = await Promise.all([
      prisma.branch.findMany({
        where,
        include: {
          _count: { 
            select: { 
              cycles: true,
              institutionalOrders: true,
            } 
          },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.branch.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({
      data: branches,
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

// Get branch by ID
branchesRouter.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const branch = await prisma.branch.findUnique({
      where: { id },
      include: {
        institutionalOrders: {
          orderBy: { startDate: 'desc' },
        },
        cycles: {
          where: { status: 'active' },
          include: {
            course: { select: { id: true, name: true } },
            instructor: { select: { id: true, name: true } },
            _count: { select: { registrations: true, meetings: true } },
          },
        },
      },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    res.json(branch);
  } catch (error) {
    next(error);
  }
});

// Create branch
branchesRouter.post('/', managerOrAdmin, async (req, res, next) => {
  try {
    const data = createBranchSchema.parse(req.body);

    const branch = await prisma.branch.create({
      data,
    });

    res.status(201).json(branch);
  } catch (error) {
    next(error);
  }
});

// Update branch
branchesRouter.put('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const data = updateBranchSchema.parse(req.body);

    const branch = await prisma.branch.update({
      where: { id },
      data,
    });

    res.json(branch);
  } catch (error) {
    next(error);
  }
});

// Delete branch
branchesRouter.delete('/:id', managerOrAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const activeCycles = await prisma.cycle.count({
      where: { branchId: id, status: 'active' },
    });

    if (activeCycles > 0) {
      throw new AppError(400, 'Cannot delete branch with active cycles');
    }

    await prisma.branch.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Get branch's institutional orders
branchesRouter.get('/:id/orders', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);

    const orders = await prisma.institutionalOrder.findMany({
      where: { branchId: id },
      include: {
        _count: { select: { cycles: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    res.json(orders);
  } catch (error) {
    next(error);
  }
});

// Create institutional order for branch
branchesRouter.post('/:id/orders', managerOrAdmin, async (req, res, next) => {
  try {
    const branchId = uuidSchema.parse(req.params.id);
    const data = createInstitutionalOrderSchema.parse({ ...req.body, branchId });

    // Verify branch exists
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const order = await prisma.institutionalOrder.create({
      data: {
        branchId,
        orderNumber: data.orderNumber,
        orderDate: data.orderDate ? new Date(data.orderDate) : null,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        pricePerMeeting: data.pricePerMeeting,
        estimatedMeetings: data.estimatedMeetings,
        estimatedTotal: data.estimatedTotal,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        contactEmail: data.contactEmail,
        contractFile: data.contractFile,
        status: data.status,
        notes: data.notes,
      },
    });

    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

// Update institutional order
branchesRouter.put('/:id/orders/:orderId', managerOrAdmin, async (req, res, next) => {
  try {
    const orderId = uuidSchema.parse(req.params.orderId);
    const data = updateInstitutionalOrderSchema.parse(req.body);

    const order = await prisma.institutionalOrder.update({
      where: { id: orderId },
      data: {
        ...data,
        orderDate: data.orderDate ? new Date(data.orderDate) : undefined,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
    });

    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Get branch's cycles
branchesRouter.get('/:id/cycles', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const status = req.query.status as string | undefined;

    const cycles = await prisma.cycle.findMany({
      where: { 
        branchId: id,
        ...(status && { status: status as any }),
      },
      include: {
        course: { select: { id: true, name: true, category: true } },
        instructor: { select: { id: true, name: true } },
        _count: { select: { registrations: true, meetings: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    res.json(cycles);
  } catch (error) {
    next(error);
  }
});
