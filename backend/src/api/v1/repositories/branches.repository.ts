import { prisma } from '../../../utils/prisma.js';
import { Prisma, BranchType } from '@prisma/client';
import { BranchQuery, CreateBranchInput, UpdateBranchInput } from '../validators/branches.js';

/**
 * Branches Repository - Data access layer
 */
export class BranchesRepository {
  /**
   * Find all branches with pagination and filters
   */
  async findAll(query: BranchQuery) {
    const { limit, offset, search, type, city, isActive, sortBy, sortOrder } = query;

    // Build where clause
    const where: Prisma.BranchWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(type && { type: type as BranchType }),
      ...(city && { city }),
      ...(isActive !== undefined && { isActive }),
    };

    // Build orderBy
    const orderBy: Prisma.BranchOrderByWithRelationInput = sortBy
      ? { [sortBy]: sortOrder || 'asc' }
      : { createdAt: 'desc' };

    // Execute queries
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
        orderBy,
        skip: offset,
        take: limit,
      }),
      prisma.branch.count({ where }),
    ]);

    return { branches, total };
  }

  /**
   * Find branch by ID
   */
  async findById(id: string) {
    return prisma.branch.findUnique({
      where: { id },
      include: {
        _count: { 
          select: { 
            cycles: true,
            institutionalOrders: true,
          } 
        },
      },
    });
  }

  /**
   * Create branch
   */
  async create(data: CreateBranchInput) {
    return prisma.branch.create({
      data: {
        name: data.name,
        type: data.type as BranchType,
        address: data.address,
        city: data.city,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        contactEmail: data.contactEmail || null,
        isActive: data.isActive,
      },
      include: {
        _count: { 
          select: { 
            cycles: true,
            institutionalOrders: true,
          } 
        },
      },
    });
  }

  /**
   * Update branch
   */
  async update(id: string, data: UpdateBranchInput) {
    return prisma.branch.update({
      where: { id },
      data: {
        ...data,
        type: data.type as BranchType | undefined,
      },
      include: {
        _count: { 
          select: { 
            cycles: true,
            institutionalOrders: true,
          } 
        },
      },
    });
  }

  /**
   * Delete branch
   */
  async delete(id: string) {
    return prisma.branch.delete({
      where: { id },
    });
  }

  /**
   * Get cycles of a branch
   */
  async getCycles(branchId: string) {
    return prisma.cycle.findMany({
      where: { branchId, deletedAt: null },
      include: {
        course: {
          select: { id: true, name: true, category: true },
        },
        instructor: {
          select: { id: true, name: true },
        },
        _count: { select: { meetings: true, registrations: true } },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * Check if branch has cycles or orders
   */
  async hasRelatedRecords(branchId: string) {
    const [cycleCount, orderCount] = await Promise.all([
      prisma.cycle.count({ where: { branchId } }),
      prisma.institutionalOrder.count({ where: { branchId } }),
    ]);
    return cycleCount > 0 || orderCount > 0;
  }
}

export const branchesRepository = new BranchesRepository();
