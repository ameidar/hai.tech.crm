import { NotFoundError, ConflictError } from '../../../common/errors/index.js';
import { branchesRepository, BranchesRepository } from '../repositories/branches.repository.js';
import { logAudit } from '../../../utils/audit.js';
import { Request } from 'express';
import { BranchQuery, CreateBranchInput, UpdateBranchInput } from '../validators/branches.js';

/**
 * Branches Service - Business logic layer
 */
export class BranchesService {
  constructor(private repository: BranchesRepository) {}

  /**
   * List all branches with pagination and filters
   */
  async list(query: BranchQuery) {
    const { branches, total } = await this.repository.findAll(query);
    return { branches, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Get single branch by ID
   */
  async getById(id: string) {
    const branch = await this.repository.findById(id);
    if (!branch) {
      throw new NotFoundError('Branch', id);
    }
    return branch;
  }

  /**
   * Create new branch
   */
  async create(data: CreateBranchInput, req?: Request) {
    const branch = await this.repository.create(data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'CREATE',
        entity: 'Branch',
        entityId: branch.id,
        newValue: { name: branch.name, type: branch.type, city: branch.city },
        req,
      });
    }

    return branch;
  }

  /**
   * Update branch
   */
  async update(id: string, data: UpdateBranchInput, req?: Request) {
    // Check if branch exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Branch', id);
    }

    const branch = await this.repository.update(id, data);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'UPDATE',
        entity: 'Branch',
        entityId: branch.id,
        oldValue: { name: existing.name, type: existing.type, isActive: existing.isActive },
        newValue: { name: branch.name, type: branch.type, isActive: branch.isActive },
        req,
      });
    }

    return branch;
  }

  /**
   * Delete branch (hard delete - only if no related records)
   */
  async delete(id: string, req?: Request) {
    // Check if branch exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('Branch', id);
    }

    // Check for related records
    const hasRelated = await this.repository.hasRelatedRecords(id);
    if (hasRelated) {
      throw new ConflictError('Cannot delete branch with existing cycles or orders. Deactivate it instead.', {
        suggestion: 'Set isActive: false',
      });
    }

    await this.repository.delete(id);

    // Audit log
    if (req) {
      await logAudit({
        userId: req.user?.userId,
        action: 'DELETE',
        entity: 'Branch',
        entityId: id,
        oldValue: { name: existing.name, type: existing.type },
        req,
      });
    }
  }

  /**
   * Get cycles of a branch
   */
  async getCycles(branchId: string) {
    // Check if branch exists
    const existing = await this.repository.findById(branchId);
    if (!existing) {
      throw new NotFoundError('Branch', branchId);
    }

    return this.repository.getCycles(branchId);
  }
}

export const branchesService = new BranchesService(branchesRepository);
