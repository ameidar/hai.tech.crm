import { z } from 'zod';

/**
 * Environment variables validation schema
 * 
 * This ensures all required environment variables are present
 * and correctly typed at application startup.
 */
export const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  
  // JWT (required in production)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1d'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  
  // API Security
  API_KEY: z.string().min(16, 'API_KEY must be at least 16 characters'),
  
  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),
  
  // Admin seed (optional, has defaults)
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(6).optional(),
  ADMIN_NAME: z.string().optional(),
  
  // External integrations (optional)
  ZOOM_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
  GMAIL_USER: z.string().email().optional().or(z.literal('')),
  GMAIL_APP_PASSWORD: z.string().optional(),
  GREEN_API_INSTANCE_ID: z.string().optional(),
  GREEN_API_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
