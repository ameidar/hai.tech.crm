// Test setup file
import { beforeAll, afterAll, beforeEach } from 'vitest';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
process.env.API_KEY = 'test-api-key';

// Mock console.error to reduce noise in tests
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: any[]) => {
    // Only show errors that aren't expected test errors
    if (!args[0]?.includes?.('[AUDIT ERROR]')) {
      originalConsoleError(...args);
    }
  };
});

afterAll(() => {
  console.error = originalConsoleError;
});
