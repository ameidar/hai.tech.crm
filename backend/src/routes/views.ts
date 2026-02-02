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
    const { additionalFilters = [] } = req.body || {};

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

    // Build Prisma where clause from view filters + additional filters
    const rawFilters = view.filters as Array<{ field: string; operator: string; value?: any }>;
    const allFilters = [...rawFilters, ...additionalFilters];
    const filters = await resolveRelationFilters(allFilters);
    const where = buildWhereClause(filters);
    console.log('[VIEW APPLY] Raw filters:', JSON.stringify(rawFilters));
    console.log('[VIEW APPLY] Additional filters:', JSON.stringify(additionalFilters));
    console.log('[VIEW APPLY] Resolved filters:', JSON.stringify(filters));
    console.log('[VIEW APPLY] Where clause:', JSON.stringify(where));

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

// Check if value looks like a UUID
function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Resolve relation field text values to actual IDs
async function resolveRelationFilters(filters: Array<{ field: string; operator: string; value?: any }>) {
  const resolvedFilters = [];
  
  for (const filter of filters) {
    let { field, operator, value } = filter;
    
    // Skip if value is already a UUID or if operator doesn't use value
    if (!value || typeof value !== 'string' || isUUID(value) || ['isNull', 'isNotNull', 'today', 'thisWeek', 'thisMonth'].includes(operator)) {
      resolvedFilters.push(filter);
      continue;
    }
    
    // Handle relation fields by looking up matching IDs
    if (field === 'branchId') {
      const branches = await prisma.branch.findMany({
        where: { name: operator === 'contains' ? { contains: value, mode: 'insensitive' } : value },
        select: { id: true },
      });
      const ids = branches.map(b => b.id);
      if (ids.length > 0) {
        resolvedFilters.push({ field: 'branchId', operator: 'in', value: ids });
      } else {
        resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
      }
    } else if (field === 'cycle.branchId') {
      // For nested relation (cycle.branchId), find cycles with matching branches, then filter by cycleId
      const branches = await prisma.branch.findMany({
        where: { name: operator === 'contains' ? { contains: value, mode: 'insensitive' } : value },
        select: { id: true },
      });
      const branchIds = branches.map(b => b.id);
      if (branchIds.length > 0) {
        const cycles = await prisma.cycle.findMany({
          where: { branchId: { in: branchIds } },
          select: { id: true },
        });
        const cycleIds = cycles.map(c => c.id);
        if (cycleIds.length > 0) {
          resolvedFilters.push({ field: 'cycleId', operator: 'in', value: cycleIds });
        } else {
          resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
        }
      } else {
        resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
      }
    } else if (field === 'courseId') {
      const courses = await prisma.course.findMany({
        where: { name: operator === 'contains' ? { contains: value, mode: 'insensitive' } : value },
        select: { id: true },
      });
      const ids = courses.map(c => c.id);
      if (ids.length > 0) {
        resolvedFilters.push({ field: 'courseId', operator: 'in', value: ids });
      } else {
        resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
      }
    } else if (field === 'cycle.courseId') {
      // For nested relation (cycle.courseId), find cycles with matching courses, then filter by cycleId
      const courses = await prisma.course.findMany({
        where: { name: operator === 'contains' ? { contains: value, mode: 'insensitive' } : value },
        select: { id: true },
      });
      const courseIds = courses.map(c => c.id);
      if (courseIds.length > 0) {
        const cycles = await prisma.cycle.findMany({
          where: { courseId: { in: courseIds } },
          select: { id: true },
        });
        const cycleIds = cycles.map(c => c.id);
        if (cycleIds.length > 0) {
          resolvedFilters.push({ field: 'cycleId', operator: 'in', value: cycleIds });
        } else {
          resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
        }
      } else {
        resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
      }
    } else if (field === 'instructorId') {
      const instructors = await prisma.instructor.findMany({
        where: { name: operator === 'contains' ? { contains: value, mode: 'insensitive' } : value },
        select: { id: true },
      });
      const ids = instructors.map(i => i.id);
      if (ids.length > 0) {
        resolvedFilters.push({ field: 'instructorId', operator: 'in', value: ids });
      } else {
        resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
      }
    } else if (field === 'cycle.instructorId') {
      // For nested relation (cycle.instructorId), find cycles with matching instructors, then filter by cycleId
      const instructors = await prisma.instructor.findMany({
        where: { name: operator === 'contains' ? { contains: value, mode: 'insensitive' } : value },
        select: { id: true },
      });
      const instructorIds = instructors.map(i => i.id);
      if (instructorIds.length > 0) {
        const cycles = await prisma.cycle.findMany({
          where: { instructorId: { in: instructorIds } },
          select: { id: true },
        });
        const cycleIds = cycles.map(c => c.id);
        if (cycleIds.length > 0) {
          resolvedFilters.push({ field: 'cycleId', operator: 'in', value: cycleIds });
        } else {
          resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
        }
      } else {
        resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
      }
    } else if (field === 'cycleId') {
      const cycles = await prisma.cycle.findMany({
        where: { name: operator === 'contains' ? { contains: value, mode: 'insensitive' } : value },
        select: { id: true },
      });
      const ids = cycles.map(c => c.id);
      if (ids.length > 0) {
        resolvedFilters.push({ field: 'cycleId', operator: 'in', value: ids });
      } else {
        resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
      }
    } else if (field === 'customerId') {
      const customers = await prisma.customer.findMany({
        where: { name: operator === 'contains' ? { contains: value, mode: 'insensitive' } : value },
        select: { id: true },
      });
      const ids = customers.map(c => c.id);
      if (ids.length > 0) {
        resolvedFilters.push({ field: 'customerId', operator: 'in', value: ids });
      } else {
        resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
      }
    } else if (field === 'studentId') {
      const students = await prisma.student.findMany({
        where: { name: operator === 'contains' ? { contains: value, mode: 'insensitive' } : value },
        select: { id: true },
      });
      const ids = students.map(s => s.id);
      if (ids.length > 0) {
        resolvedFilters.push({ field: 'studentId', operator: 'in', value: ids });
      } else {
        resolvedFilters.push({ field: 'id', operator: 'equals', value: 'no-match' });
      }
    } else {
      // Not a relation field, keep as-is
      resolvedFilters.push(filter);
    }
  }
  
  return resolvedFilters;
}

// Helper to build Prisma where clause from filters
function buildWhereClause(filters: Array<{ field: string; operator: string; value?: any }>) {
  const where: any = {};

  for (const filter of filters) {
    const { field, operator, value } = filter;
    let filterValue: any;

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
        // Dates in DB are stored at 00:00 UTC for the date
        // Use Israel time (+2 hours) to determine "today"
        const nowIsrael = new Date(Date.now() + 2 * 60 * 60 * 1000); // Add 2 hours for Israel
        const todayStr = nowIsrael.toISOString().split('T')[0]; // YYYY-MM-DD
        const today = new Date(todayStr + 'T00:00:00.000Z');
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        filterValue = { gte: today, lt: tomorrow };
        break;
      case 'thisWeek':
        const nowIsraelWeek = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const startOfWeek = new Date(nowIsraelWeek);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        const startOfWeekStr = startOfWeek.toISOString().split('T')[0];
        const weekStart = new Date(startOfWeekStr + 'T00:00:00.000Z');
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        filterValue = { gte: weekStart, lt: weekEnd };
        break;
      case 'thisMonth':
        const nowIsraelMonth = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const monthStr = nowIsraelMonth.toISOString().slice(0, 7); // YYYY-MM
        const monthStart = new Date(monthStr + '-01T00:00:00.000Z');
        const monthEnd = new Date(monthStart);
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        filterValue = { gte: monthStart, lt: monthEnd };
        break;
      default:
        continue;
    }

    // Support nested fields like "cycle.branchId"
    if (field.includes('.')) {
      setNestedValue(where, field, filterValue);
    } else {
      // Merge with existing filter on the same field if it exists
      // This handles cases like scheduledDate: { gte: ..., lt: ... }
      if (where[field] && typeof where[field] === 'object' && typeof filterValue === 'object') {
        where[field] = { ...where[field], ...filterValue };
      } else {
        where[field] = filterValue;
      }
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
  
  // Build orderBy - handle nested fields like "cycle.branchId"
  let orderBy: any = undefined;
  if (sortBy) {
    if (sortBy.includes('.')) {
      // Nested field - convert "cycle.branchId" to { cycle: { branchId: 'desc' } }
      const parts = sortBy.split('.');
      orderBy = {};
      let current = orderBy;
      for (let i = 0; i < parts.length - 1; i++) {
        current[parts[i]] = {};
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = sortOrder || 'desc';
    } else {
      orderBy = { [sortBy]: sortOrder || 'desc' };
    }
  }

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

  let data, total;
  try {
    [data, total] = await Promise.all([
      config.model.findMany({
        where,
        include: config.defaultInclude,
        orderBy,
        skip,
        take: limit,
      }),
      config.model.count({ where }),
    ]);
  } catch (error) {
    console.error('[VIEW APPLY ERROR]', error);
    throw error;
  }

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
        // scheduledDate removed - date is controlled by the date picker, not views
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
