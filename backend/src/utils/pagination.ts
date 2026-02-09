// Pagination utility

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
  sort: string;
  order: 'asc' | 'desc';
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function parsePaginationParams(query: any): PaginationParams {
  const page = Math.max(1, parseInt(query.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit as string) || 20));
  const skip = (page - 1) * limit;
  const take = limit;
  const sort = (query.sort as string) || 'createdAt';
  const order = (query.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';

  return { page, limit, skip, take, sort, order };
}

export function paginatedResponse<T>(data: T[], total: number, page: number, limit: number) {
  const totalPages = Math.ceil(total / limit);
  
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    } as PaginationMeta,
  };
}
