import 'dotenv/config';

// Validate required secrets at startup
const requiredSecrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'API_KEY'] as const;
const missingSecrets = requiredSecrets.filter((key) => !process.env[key]);

if (missingSecrets.length > 0) {
  console.error('❌ Missing required environment variables:', missingSecrets.join(', '));
  console.error('Please set these secrets before starting the application.');
  process.exit(1);
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Database
  databaseUrl: process.env.DATABASE_URL || '',
  
  // JWT - no fallbacks, validated above
  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  
  // CORS
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  
  // Frontend URL for links in messages
  frontendUrl: process.env.FRONTEND_URL || 'https://crm.orma-ai.com',
  
  // Admin seed
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@haitech.co.il',
    password: process.env.ADMIN_PASSWORD || 'admin123',
    name: process.env.ADMIN_NAME || 'מנהל מערכת',
  },
  
  // External integrations - no fallbacks for API_KEY, validated above
  apiKey: process.env.API_KEY!,
  zoomWebhookUrl: process.env.ZOOM_WEBHOOK_URL || '',
  
  // Gmail SMTP
  gmailUser: process.env.GMAIL_USER || '',
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASS || '',
  
  // Green API (WhatsApp)
  greenApiInstanceId: process.env.GREEN_API_INSTANCE_ID || '',
  greenApiToken: process.env.GREEN_API_TOKEN || '',


  // Vapi AI Calling
  vapiApiKey: process.env.VAPI_API_KEY || '',
  vapiAssistantId: process.env.VAPI_ASSISTANT_ID || '',
  vapiPhoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || '',
};
