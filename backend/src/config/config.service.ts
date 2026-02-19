import 'dotenv/config';
import { envSchema, type Env } from './env.schema.js';
import { ZodError } from 'zod';

/**
 * Validated and typed configuration
 */
export interface AppConfig {
  // Environment
  nodeEnv: 'development' | 'production' | 'test';
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  
  // Server
  port: number;
  logLevel: string;
  
  // Database
  databaseUrl: string;
  
  // JWT
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  
  // API
  apiKey: string;
  
  // CORS
  corsOrigins: string[];
  
  // Admin
  admin: {
    email: string;
    password: string;
    name: string;
  };
  
  // External integrations
  zoomWebhookUrl: string;
  gmailUser: string;
  gmailAppPassword: string;
  greenApiInstanceId: string;
  greenApiToken: string;
}

/**
 * Parse and validate environment variables
 */
function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => {
        const path = issue.path.join('.');
        return `  - ${path}: ${issue.message}`;
      });
      
      console.error('❌ Environment validation failed:');
      console.error(issues.join('\n'));
      console.error('\nPlease check your .env file or environment variables.');
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Build the application configuration from validated environment variables
 */
function buildConfig(env: Env): AppConfig {
  return {
    // Environment
    nodeEnv: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    
    // Server
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    
    // Database
    databaseUrl: env.DATABASE_URL,
    
    // JWT
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
      refreshSecret: env.JWT_REFRESH_SECRET,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
    
    // API
    apiKey: env.API_KEY,
    
    // CORS
    corsOrigins: env.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
    
    // Admin
    admin: {
      email: env.ADMIN_EMAIL || 'admin@haitech.co.il',
      password: env.ADMIN_PASSWORD || 'admin123',
      name: env.ADMIN_NAME || 'מנהל מערכת',
    },
    
    // External integrations
    zoomWebhookUrl: env.ZOOM_WEBHOOK_URL || '',
    gmailUser: env.GMAIL_USER || '',
    gmailAppPassword: env.GMAIL_APP_PASSWORD || '',
    greenApiInstanceId: env.GREEN_API_INSTANCE_ID || '',
    greenApiToken: env.GREEN_API_TOKEN || '',
  };
}

// Validate and build config at module load time
const env = validateEnv();

/**
 * Application configuration (validated and typed)
 */
export const appConfig: AppConfig = buildConfig(env);
