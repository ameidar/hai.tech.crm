import { describe, it, expect } from 'vitest';
import { 
  loginSchema, 
  createCustomerSchema, 
  createCourseSchema,
  uuidSchema,
  paginationSchema,
} from '../src/types/schemas.js';

describe('Validation Schemas', () => {
  describe('loginSchema', () => {
    it('should validate correct login data', () => {
      const result = loginSchema.safeParse({
        email: 'test@example.com',
        password: 'password123',
      });
      
      expect(result.success).toBe(true);
    });

    it('should reject invalid email', () => {
      const result = loginSchema.safeParse({
        email: 'not-an-email',
        password: 'password123',
      });
      
      expect(result.success).toBe(false);
    });

    it('should reject missing password', () => {
      const result = loginSchema.safeParse({
        email: 'test@example.com',
      });
      
      expect(result.success).toBe(false);
    });
  });

  describe('createCustomerSchema', () => {
    it('should validate correct customer data', () => {
      const result = createCustomerSchema.safeParse({
        name: 'ישראל ישראלי',
        phone: '050-1234567',
        email: 'israel@example.com',
      });
      
      expect(result.success).toBe(true);
    });

    it('should validate customer without email', () => {
      const result = createCustomerSchema.safeParse({
        name: 'ישראל ישראלי',
        phone: '050-1234567',
      });
      
      expect(result.success).toBe(true);
    });

    it('should reject missing name', () => {
      const result = createCustomerSchema.safeParse({
        phone: '050-1234567',
      });
      
      expect(result.success).toBe(false);
    });

    it('should reject missing phone', () => {
      const result = createCustomerSchema.safeParse({
        name: 'ישראל ישראלי',
      });
      
      expect(result.success).toBe(false);
    });
  });

  describe('createCourseSchema', () => {
    it('should validate correct course data', () => {
      const result = createCourseSchema.safeParse({
        name: 'מיינקראפט JavaScript',
        category: 'programming',
        description: 'קורס תכנות במיינקראפט',
      });
      
      expect(result.success).toBe(true);
    });

    it('should reject invalid category', () => {
      const result = createCourseSchema.safeParse({
        name: 'קורס לא תקין',
        category: 'invalid_category',
      });
      
      expect(result.success).toBe(false);
    });

    it('should accept all valid categories', () => {
      const categories = ['programming', 'ai', 'robotics', 'printing_3d'];
      
      for (const category of categories) {
        const result = createCourseSchema.safeParse({
          name: 'Test Course',
          category,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('uuidSchema', () => {
    it('should validate correct UUID', () => {
      const result = uuidSchema.safeParse('550e8400-e29b-41d4-a716-446655440000');
      
      expect(result.success).toBe(true);
    });

    it('should validate any non-empty string (current implementation)', () => {
      // Note: current schema only checks for non-empty string
      const result = uuidSchema.safeParse('some-id');
      
      expect(result.success).toBe(true);
    });

    it('should reject empty string', () => {
      const result = uuidSchema.safeParse('');
      
      expect(result.success).toBe(false);
    });
  });

  describe('paginationSchema', () => {
    it('should provide defaults for empty input', () => {
      const result = paginationSchema.parse({});
      
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50); // Default is 50
    });

    it('should parse valid numbers', () => {
      const result = paginationSchema.parse({ page: 5, limit: 100 });
      
      expect(result.page).toBe(5);
      expect(result.limit).toBe(100);
    });

    it('should reject invalid page values', () => {
      const result = paginationSchema.safeParse({ page: -1 });
      
      expect(result.success).toBe(false);
    });

    it('should enforce maximum limit of 500', () => {
      const result = paginationSchema.safeParse({ limit: 1000 });
      
      expect(result.success).toBe(false);
    });

    it('should accept limit up to 500', () => {
      const result = paginationSchema.parse({ limit: 500 });
      
      expect(result.limit).toBe(500);
    });
  });
});
