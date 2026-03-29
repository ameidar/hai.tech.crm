// @ts-nocheck
import { prisma } from '../../../utils/prisma.js';
import { Prisma } from '@prisma/client';

export interface ApiKeyFilters {
  isActive?: boolean;
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * API Keys Repository - Database access layer
 */
export class ApiKeysRepository {
  /**
   * Find API key by hash (for authentication)
   */
  async findByHash(keyHash: string) {
    return prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });
  }

  /**
   * Find API key by ID
   */
  async findById(id: string) {
    return prisma.apiKey.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });
  }

  /**
   * Find API keys with filters and pagination
   */
  async findMany(filters: ApiKeyFilters, pagination: PaginationParams) {
    const where: Prisma.ApiKeyWhereInput = {};

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    const [items, total] = await Promise.all([
      prisma.apiKey.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: pagination.limit,
        skip: pagination.offset,
      }),
      prisma.apiKey.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Create a new API key
   */
  async create(data: {
    name: string;
    keyHash: string;
    keyPrefix: string;
    scopes: string[];
    rateLimit: number;
    expiresAt?: Date | null;
    createdById: string;
  }) {
    return prisma.apiKey.create({
      data: {
        name: data.name,
        keyHash: data.keyHash,
        keyPrefix: data.keyPrefix,
        scopes: data.scopes,
        rateLimit: data.rateLimit,
        expiresAt: data.expiresAt,
        createdById: data.createdById,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Update an API key
   */
  async update(id: string, data: Prisma.ApiKeyUpdateInput) {
    return prisma.apiKey.update({
      where: { id },
      data,
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Update last used timestamp and IP
   */
  async updateLastUsed(id: string, ip: string) {
    return prisma.apiKey.update({
      where: { id },
      data: {
        lastUsedAt: new Date(),
        lastUsedIp: ip,
      },
    });
  }

  /**
   * Delete an API key
   */
  async delete(id: string) {
    return prisma.apiKey.delete({
      where: { id },
    });
  }

  /**
   * Check if an API key exists by prefix (for faster lookups)
   */
  async existsByPrefix(keyPrefix: string) {
    const count = await prisma.apiKey.count({
      where: { keyPrefix },
    });
    return count > 0;
  }
}

export const apiKeysRepository = new ApiKeysRepository();
