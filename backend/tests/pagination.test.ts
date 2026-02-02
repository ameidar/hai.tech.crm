import { describe, it, expect } from 'vitest';
import { parsePaginationParams, paginatedResponse } from '../src/utils/pagination.js';

describe('Pagination Utility', () => {
  describe('parsePaginationParams', () => {
    it('should return default values for empty query', () => {
      const result = parsePaginationParams({});
      
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.skip).toBe(0);
      expect(result.take).toBe(20);
      expect(result.sort).toBe('createdAt');
      expect(result.order).toBe('desc');
    });

    it('should parse valid page and limit', () => {
      const result = parsePaginationParams({ page: '3', limit: '50' });
      
      expect(result.page).toBe(3);
      expect(result.limit).toBe(50);
      expect(result.skip).toBe(100); // (3-1) * 50
      expect(result.take).toBe(50);
    });

    it('should enforce minimum page of 1', () => {
      const result = parsePaginationParams({ page: '-5' });
      
      expect(result.page).toBe(1);
    });

    it('should enforce maximum limit of 100', () => {
      const result = parsePaginationParams({ limit: '500' });
      
      expect(result.limit).toBe(100);
    });

    it('should enforce minimum limit of 1', () => {
      const result = parsePaginationParams({ limit: '-10' });
      
      expect(result.limit).toBe(1);
    });

    it('should parse sort and order', () => {
      const result = parsePaginationParams({ sort: 'name', order: 'asc' });
      
      expect(result.sort).toBe('name');
      expect(result.order).toBe('asc');
    });

    it('should default order to desc for invalid values', () => {
      const result = parsePaginationParams({ order: 'invalid' });
      
      expect(result.order).toBe('desc');
    });
  });

  describe('paginatedResponse', () => {
    it('should return correct pagination metadata', () => {
      const data = [{ id: 1 }, { id: 2 }];
      const result = paginatedResponse(data, 50, 1, 20);
      
      expect(result.data).toEqual(data);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
      expect(result.pagination.total).toBe(50);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it('should correctly calculate hasNext and hasPrev', () => {
      const data = [{ id: 1 }];
      
      // First page
      let result = paginatedResponse(data, 100, 1, 20);
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrev).toBe(false);
      
      // Middle page
      result = paginatedResponse(data, 100, 3, 20);
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrev).toBe(true);
      
      // Last page
      result = paginatedResponse(data, 100, 5, 20);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(true);
    });

    it('should handle single page correctly', () => {
      const data = [{ id: 1 }];
      const result = paginatedResponse(data, 5, 1, 20);
      
      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it('should handle empty data', () => {
      const result = paginatedResponse([], 0, 1, 20);
      
      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });
  });
});
