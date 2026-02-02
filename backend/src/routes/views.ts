import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

// Valid entities for views
const VALID_ENTITIES = [
  'meetings',
  'cycles',
  'customers',
  'students',
  'courses',
  'branches',
  'instructors',
  'registrations',
] as const;

// Schema for creating/updating views
const viewSchema = z.object({
  name: z.string().min(1).max(100),
  entity: z.enum(VALID_ENTITIES),
  filters: z.array(z.object({
    field: z.string(),
    operator: z.enum(['equals', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'isNull', 'isNotNull', 'between', 'today', 'thisWeek', 'thisMonth']),
    value: z.any().optional(),
  })),
  columns: z.array(z.string()).min(1),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  isDefault: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

export const viewsRouter = Router();

viewsRouter.use(authenticate);

// Get all views for current user (including public views)
viewsRouter.get('/', async (req, res, next) => {
  try {
    const entity = req.query.entity as string | undefined;

    const where = {
      OR: [
        { createdById: req.user!.userId },
        { isPublic: true },
      ],
      ...(entity && { entity }),
    };

    const views = await prisma.savedView.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: [
        { isDefault: 'desc' },
        { name: 'asc' },
      ],
    });

    res.json(views);
  } catch (error) {
    next(error);
  }
});

// Get view by ID
viewsRouter.get('/:id', async (req, res, next) => {
  try {
    const view = await prisma.savedView.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
      },
    });

    if (!view) {
      throw new AppError(404, 'View not found');
    }

    // Check access
    if (!view.isPublic && view.createdById !== req.user!.userId) {
      throw new AppError(403, 'Access denied');
    }

    res.json(view);
  } catch (error) {
    next(error);
  }
});

// Create new view
viewsRouter.post('/', async (req, res, next) => {
  try {
    const data = viewSchema.parse(req.body);

    // If setting as default, unset other defaults for this entity
    if (data.isDefault) {
      await prisma.savedView.updateMany({
        where: {
          createdById: req.user!.userId,
          entity: data.entity,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    const view = await prisma.savedView.create({
      data: {
        name: data.name,
        entity: data.entity,
        filters: data.filters,
        columns: data.columns,
        sortBy: data.sortBy,
        sortOrder: data.sortOrder,
        isDefault: data.isDefault || false,
        isPublic: data.isPublic || false,
        createdById: req.user!.userId,
      },
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
      },
    });

    res.status(201).json(view);
  } catch (error) {
    next(error);
  }
});

// Update view
viewsRouter.put('/:id', async (req, res, next) => {
  try {
    const data = viewSchema.parse(req.body);

    const existingView = await prisma.savedView.findUnique({
      where: { id: req.params.id },
    });

    if (!existingView) {
      throw new AppError(404, 'View not found');
    }

    // Only creator can edit
    if (existingView.createdById !== req.user!.userId) {
      throw new AppError(403, 'Only the creator can edit this view');
    }

    // If setting as default, unset other defaults
    if (data.isDefault && !existingView.isDefault) {
      await prisma.savedView.updateMany({
        where: {
          createdById: req.user!.userId,
          entity: data.entity,
          isDefault: true,
          id: { not: req.params.id },
        },
        data: { isDefault: false },
      });
    }

    const view = await prisma.savedView.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        entity: data.entity,
        filters: data.filters,
        columns: data.columns,
        sortBy: data.sortBy,
        sortOrder: data.sortOrder,
        isDefault: data.isDefault || false,
        isPublic: data.isPublic || false,
      },
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
      },
    });

    res.json(view);
  } catch (error) {
    next(error);
  }
});

// Delete view
viewsRouter.delete('/:id', async (req, res, next) => {
  try {
    const existingView = await prisma.savedView.findUnique({
      where: { id: req.params.id },
    });

    if (!existingView) {
      throw new AppError(404, 'View not found');
    }

    // Only creator can delete
    if (existingView.createdById !== req.user!.userId) {
      throw new AppError(403, 'Only the creator can delete this view');
    }

    await prisma.savedView.delete({
      where: { id: req.params.id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Apply view filters to get data
viewsRouter.post('/:id/apply', async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;

    const view = await prisma.savedView.findUnique({
      where: { id: req.params.id },
    });

    if (!view) {
      throw new AppError(404, 'View not found');
    }

    // Check access
    if (!view.isPublic && view.createdById !== req.user!.userId) {
      throw new AppError(403, 'Access denied');
    }

    // Build Prisma where clause from filters
    const filters = view.filters as Array<{ field: string; operator: string; value?: any }>;
    const where = buildWhereClause(filters);

    // Get data based on entity
    const result = await getEntityData(
      view.entity,
      where,
      view.columns as string[],
      view.sortBy || undefined,
      view.sortOrder as 'asc' | 'desc' | undefined,
      Number(page),
      Number(limit)
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Helper to set nested value in object
function setNestedValue(obj: any, path: string, value: any) {
  const parts = path.split('.');
  let current = obj;
  
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  
  current[parts[parts.length - 1]] = value;
}

// Map relation ID fields to their name paths for text filtering
const RELATION_FIELD_MAP: Record<string, string> = {
  'branchId': 'branch.name',
  'courseId': 'course.name',
  'instructorId': 'instructor.name',
  'cycleId': 'cycle.name',
  'customerId': 'customer.name',
  'studentId': 'student.name',
  'cycle.branchId': 'cycle.branch.name',
  'cycle.courseId': 'cycle.course.name',
  'cycle.instructorId': 'cycle.instructor.name',
};

// Check if value looks like a UUID
function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Helper to build Prisma where clause from filters
function buildWhereClause(filters: Array<{ field: string; operator: string; value?: any }>) {
  const where: any = {};

  for (const filter of filters) {
    let { field, operator, value } = filter;
    let filterValue: any;

    // Convert relation ID fields to name paths for text filtering
    // Only do this if the value is not a UUID (i.e., user entered text like "אורט")
    if (RELATION_FIELD_MAP[field] && typeof value === 'string' && !isUUID(value)) {
      field = RELATION_FIELD_MAP[field];
    }

    switch (operator) {
      case 'equals':
        filterValue = value;
        break;
      case 'contains':
        filterValue = { contains: value, mode: 'insensitive' };
        break;
      case 'gt':
        filterValue = { gt: value };
        break;
      case 'gte':
        filterValue = { gte: value };
        break;
      case 'lt':
        filterValue = { lt: value };
        break;
      case 'lte':
        filterValue = { lte: value };
        break;
      case 'in':
        filterValue = { in: value };
        break;
      case 'notIn':
        filterValue = { notIn: value };
        break;
      case 'isNull':
        filterValue = null;
        break;
      case 'isNotNull':
        filterValue = { not: null };
        break;
      case 'between':
        if (Array.isArray(value) && value.length === 2) {
          filterValue = { gte: value[0], lte: value[1] };
        }
        break;
      case 'today':
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        filterValue = { gte: today, lt: tomorrow };
        break;
      case 'thisWeek':
        const startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 7);
        filterValue = { gte: startOfWeek, lt: endOfWeek };
        break;
      case 'thisMonth':
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const endOfMonth = new Date(startOfMonth);
        endOfMonth.setMonth(endOfMonth.getMonth() + 1);
        filterValue = { gte: startOfMonth, lt: endOfMonth };
        break;
      default:
        continue;
    }

    // Support nested fields like "cycle.branchId"
    if (field.includes('.')) {
      setNestedValue(where, field, filterValue);
    } else {
      where[field] = filterValue;
    }
  }

  return where;
}

// Helper to get entity data with dynamic columns
async function getEntityData(
  entity: string,
  where: any,
  columns: string[],
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
  page: number = 1,
  limit: number = 50
) {
  const skip = (page - 1) * limit;
  const orderBy = sortBy ? { [sortBy]: sortOrder || 'desc' } : undefined;

  // Map entity to Prisma model and includes
  const entityConfig: Record<string, { model: any; defaultInclude: any }> = {
    meetings: {
      model: prisma.meeting,
      defaultInclude: {
        cycle: { 
          select: { 
            id: true, 
            name: true,
            branch: { select: { id: true, name: true } },
            course: { select: { id: true, name: true } },
          } 
        },
        instructor: { select: { id: true, name: true } },
      },
    },
    cycles: {
      model: prisma.cycle,
      defaultInclude: {
        course: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
      },
    },
    customers: {
      model: prisma.customer,
      defaultInclude: {
        _count: { select: { students: true } },
      },
    },
    students: {
      model: prisma.student,
      defaultInclude: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    },
    courses: {
      model: prisma.course,
      defaultInclude: {
        _count: { select: { cycles: true } },
      },
    },
    branches: {
      model: prisma.branch,
      defaultInclude: {
        _count: { select: { cycles: true } },
      },
    },
    instructors: {
      model: prisma.instructor,
      defaultInclude: {
        _count: { select: { cycles: true } },
      },
    },
    registrations: {
      model: prisma.registration,
      defaultInclude: {
        student: { select: { id: true, name: true } },
        cycle: { select: { id: true, name: true } },
      },
    },
  };

  const config = entityConfig[entity];
  if (!config) {
    throw new AppError(400, `Invalid entity: ${entity}`);
  }

  const [data, total] = await Promise.all([
    config.model.findMany({
      where,
      include: config.defaultInclude,
      orderBy,
      skip,
      take: limit,
    }),
    config.model.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    data,
    columns,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

// Get available fields for an entity
viewsRouter.get('/fields/:entity', async (req, res, next) => {
  try {
    const entity = req.params.entity;

    if (!VALID_ENTITIES.includes(entity as any)) {
      throw new AppError(400, `Invalid entity: ${entity}`);
    }

    // Define available fields for each entity
    const entityFields: Record<string, Array<{ name: string; label: string; type: string }>> = {
      meetings: [
        { name: 'id', label: 'מזהה', type: 'string' },
        { name: 'scheduledDate', label: 'תאריך', type: 'date' },
        { name: 'startTime', label: 'שעת התחלה', type: 'time' },
        { name: 'endTime', label: 'שעת סיום', type: 'time' },
        { name: 'status', label: 'סטטוס', type: 'enum' },
        { name: 'revenue', label: 'הכנסה', type: 'number' },
        { name: 'instructorPayment', label: 'תשלום למדריך', type: 'number' },
        { name: 'profit', label: 'רווח', type: 'number' },
        { name: 'topic', label: 'נושא', type: 'string' },
        { name: 'notes', label: 'הערות', type: 'string' },
        { name: 'cycleId', label: 'מחזור', type: 'relation' },
        { name: 'instructorId', label: 'מדריך', type: 'relation' },
        { name: 'cycle.branchId', label: 'סניף', type: 'relation' },
        { name: 'cycle.courseId', label: 'קורס', type: 'relation' },
      ],
      cycles: [
        { name: 'id', label: 'מזהה', type: 'string' },
        { name: 'name', label: 'שם', type: 'string' },
        { name: 'type', label: 'סוג', type: 'enum' },
        { name: 'status', label: 'סטטוס', type: 'enum' },
        { name: 'startDate', label: 'תאריך התחלה', type: 'date' },
        { name: 'endDate', label: 'תאריך סיום', type: 'date' },
        { name: 'dayOfWeek', label: 'יום בשבוע', type: 'enum' },
        { name: 'totalMeetings', label: 'סה"כ מפגשים', type: 'number' },
        { name: 'completedMeetings', label: 'מפגשים שהושלמו', type: 'number' },
        { name: 'remainingMeetings', label: 'מפגשים שנותרו', type: 'number' },
        { name: 'courseId', label: 'קורס', type: 'relation' },
        { name: 'branchId', label: 'סניף', type: 'relation' },
        { name: 'instructorId', label: 'מדריך', type: 'relation' },
      ],
      customers: [
        { name: 'id', label: 'מזהה', type: 'string' },
        { name: 'name', label: 'שם', type: 'string' },
        { name: 'email', label: 'אימייל', type: 'string' },
        { name: 'phone', label: 'טלפון', type: 'string' },
        { name: 'city', label: 'עיר', type: 'string' },
        { name: 'createdAt', label: 'תאריך יצירה', type: 'date' },
      ],
      students: [
        { name: 'id', label: 'מזהה', type: 'string' },
        { name: 'name', label: 'שם', type: 'string' },
        { name: 'birthDate', label: 'תאריך לידה', type: 'date' },
        { name: 'grade', label: 'כיתה', type: 'string' },
        { name: 'customerId', label: 'לקוח', type: 'relation' },
        { name: 'createdAt', label: 'תאריך יצירה', type: 'date' },
      ],
      courses: [
        { name: 'id', label: 'מזהה', type: 'string' },
        { name: 'name', label: 'שם', type: 'string' },
        { name: 'category', label: 'קטגוריה', type: 'enum' },
        { name: 'isActive', label: 'פעיל', type: 'boolean' },
        { name: 'createdAt', label: 'תאריך יצירה', type: 'date' },
      ],
      branches: [
        { name: 'id', label: 'מזהה', type: 'string' },
        { name: 'name', label: 'שם', type: 'string' },
        { name: 'type', label: 'סוג', type: 'enum' },
        { name: 'city', label: 'עיר', type: 'string' },
        { name: 'isActive', label: 'פעיל', type: 'boolean' },
        { name: 'createdAt', label: 'תאריך יצירה', type: 'date' },
      ],
      instructors: [
        { name: 'id', label: 'מזהה', type: 'string' },
        { name: 'name', label: 'שם', type: 'string' },
        { name: 'phone', label: 'טלפון', type: 'string' },
        { name: 'email', label: 'אימייל', type: 'string' },
        { name: 'isActive', label: 'פעיל', type: 'boolean' },
        { name: 'rateFrontal', label: 'תעריף פרונטלי', type: 'number' },
        { name: 'rateOnline', label: 'תעריף אונליין', type: 'number' },
      ],
      registrations: [
        { name: 'id', label: 'מזהה', type: 'string' },
        { name: 'status', label: 'סטטוס', type: 'enum' },
        { name: 'paymentStatus', label: 'סטטוס תשלום', type: 'enum' },
        { name: 'amount', label: 'סכום', type: 'number' },
        { name: 'registrationDate', label: 'תאריך הרשמה', type: 'date' },
        { name: 'studentId', label: 'תלמיד', type: 'relation' },
        { name: 'cycleId', label: 'מחזור', type: 'relation' },
      ],
    };

    res.json(entityFields[entity] || []);
  } catch (error) {
    next(error);
  }
});
