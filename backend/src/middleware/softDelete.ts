// Soft delete helper utilities for HaiTech CRM
// Models that support soft delete: Customer, Student, Cycle, Meeting, Registration

export const SOFT_DELETE_MODELS = ['Customer', 'Student', 'Cycle', 'Meeting', 'Registration'] as const;
export type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

export function isSoftDeleteModel(model: string): model is SoftDeleteModel {
  return SOFT_DELETE_MODELS.includes(model as SoftDeleteModel);
}

export function notDeleted<T extends Record<string, unknown>>(where?: T): T & { deletedAt: null } {
  return { ...where, deletedAt: null } as T & { deletedAt: null };
}

export function softDeleteData(userId: string) {
  return { deletedAt: new Date(), deletedBy: userId };
}

export function restoreData() {
  return { deletedAt: null, deletedBy: null };
}
