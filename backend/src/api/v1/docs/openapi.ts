/**
 * OpenAPI 3.0 Specification for HaiTech CRM API
 */
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'HaiTech CRM API',
    description: `
# HaiTech CRM API

מערכת CRM לניהול קורסים ומחזורים של Hai.Tech.

## Authentication

ה-API תומך בשני סוגי אימות:

### JWT Token
\`\`\`
Authorization: Bearer <jwt_token>
\`\`\`

### API Key
\`\`\`
X-API-Key: haitech_xxx...
\`\`\`

או

\`\`\`
Authorization: Bearer haitech_xxx...
\`\`\`

## Rate Limiting

כל request מוגבל לפי:
- API Key: לפי הגדרת ה-key (ברירת מחדל 1000/שעה)
- User: 2000-10000/שעה לפי role
- IP: 100/שעה (anonymous)

Headers:
- \`X-RateLimit-Limit\`: מקסימום requests
- \`X-RateLimit-Remaining\`: requests שנותרו
- \`X-RateLimit-Reset\`: Unix timestamp לאיפוס

## Webhooks

ניתן להירשם ל-webhooks לקבלת התראות על אירועים:
- customer.created, customer.updated, customer.deleted
- meeting.completed, meeting.cancelled
- lead.received
- ועוד...

כל webhook כולל HMAC-SHA256 signature ב-header \`X-Webhook-Signature\`.
    `,
    version: '1.0.0',
    contact: {
      name: 'Hai.Tech Support',
      email: 'support@hai.tech',
      url: 'https://hai.tech',
    },
  },
  servers: [
    {
      url: '/api/v1',
      description: 'API v1',
    },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication endpoints' },
    { name: 'Customers', description: 'Customer management' },
    { name: 'Students', description: 'Student management' },
    { name: 'Courses', description: 'Course definitions' },
    { name: 'Branches', description: 'Branch/location management' },
    { name: 'Instructors', description: 'Instructor management' },
    { name: 'Cycles', description: 'Class cycles/groups' },
    { name: 'Meetings', description: 'Meeting/lesson management' },
    { name: 'Registrations', description: 'Student registrations' },
    { name: 'Attendance', description: 'Attendance tracking' },
    { name: 'API Keys', description: 'API key management (admin only)' },
    { name: 'Webhooks', description: 'Webhook management (admin only)' },
    { name: 'Reports', description: 'Reports and analytics' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token from /auth/login',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key (haitech_xxx...)',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'NOT_FOUND' },
              message: { type: 'string', example: 'Resource not found' },
              details: { type: 'object' },
            },
          },
          meta: { $ref: '#/components/schemas/Meta' },
        },
      },
      Meta: {
        type: 'object',
        properties: {
          requestId: { type: 'string', format: 'uuid' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          hasMore: { type: 'boolean' },
        },
      },
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          address: { type: 'string' },
          city: { type: 'string' },
          notes: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Meeting: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          cycleId: { type: 'string', format: 'uuid' },
          instructorId: { type: 'string', format: 'uuid' },
          scheduledDate: { type: 'string', format: 'date' },
          startTime: { type: 'string', format: 'time' },
          endTime: { type: 'string', format: 'time' },
          status: { type: 'string', enum: ['scheduled', 'completed', 'cancelled', 'postponed'] },
          revenue: { type: 'number' },
          instructorPayment: { type: 'number' },
          profit: { type: 'number' },
          topic: { type: 'string' },
          notes: { type: 'string' },
        },
      },
      Cycle: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          courseId: { type: 'string', format: 'uuid' },
          branchId: { type: 'string', format: 'uuid' },
          instructorId: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['private', 'institutional_per_child', 'institutional_fixed'] },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          dayOfWeek: { type: 'string' },
          totalMeetings: { type: 'integer' },
          completedMeetings: { type: 'integer' },
          remainingMeetings: { type: 'integer' },
          status: { type: 'string', enum: ['active', 'completed', 'cancelled'] },
        },
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          keyPrefix: { type: 'string', example: 'haitech_abc12345' },
          scopes: { type: 'array', items: { type: 'string' } },
          rateLimit: { type: 'integer' },
          isActive: { type: 'boolean' },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Webhook: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['active', 'paused', 'disabled'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: 'Authentication required',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              error: { code: 'UNAUTHORIZED', message: 'No token provided' },
              meta: { requestId: '123e4567-e89b-12d3-a456-426614174000', timestamp: '2026-02-06T12:00:00Z' },
            },
          },
        },
      },
      Forbidden: {
        description: 'Insufficient permissions',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      RateLimited: {
        description: 'Rate limit exceeded',
        headers: {
          'Retry-After': { schema: { type: 'integer' }, description: 'Seconds until rate limit resets' },
        },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
    },
  },
  security: [
    { bearerAuth: [] },
    { apiKey: [] },
  ],
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 6 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    accessToken: { type: 'string' },
                    refreshToken: { type: 'string' },
                    user: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        email: { type: 'string' },
                        name: { type: 'string' },
                        role: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/meetings': {
      get: {
        tags: ['Meetings'],
        summary: 'List meetings',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'instructorId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'cycleId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['scheduled', 'completed', 'cancelled', 'postponed'] } },
        ],
        responses: {
          200: {
            description: 'List of meetings',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Meeting' } },
                    pagination: { $ref: '#/components/schemas/Pagination' },
                    meta: { $ref: '#/components/schemas/Meta' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api-keys': {
      get: {
        tags: ['API Keys'],
        summary: 'List API keys (admin only)',
        responses: {
          200: {
            description: 'List of API keys',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } },
                    pagination: { $ref: '#/components/schemas/Pagination' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
      post: {
        tags: ['API Keys'],
        summary: 'Create API key (admin only)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', description: 'Friendly name for the API key' },
                  scopes: { 
                    type: 'array', 
                    items: { type: 'string' },
                    example: ['read:*', 'write:meetings'],
                  },
                  rateLimit: { type: 'integer', default: 1000 },
                  expiresAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'API key created (includes secret key - shown only once!)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      allOf: [
                        { $ref: '#/components/schemas/ApiKey' },
                        { 
                          type: 'object',
                          properties: {
                            key: { type: 'string', description: 'The API key - save this, it won\'t be shown again!' },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/webhooks': {
      get: {
        tags: ['Webhooks'],
        summary: 'List webhooks (admin only)',
        responses: {
          200: {
            description: 'List of webhooks',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Webhook' } },
                    pagination: { $ref: '#/components/schemas/Pagination' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Webhooks'],
        summary: 'Create webhook (admin only)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'url', 'events'],
                properties: {
                  name: { type: 'string' },
                  url: { type: 'string', format: 'uri' },
                  events: { 
                    type: 'array', 
                    items: { type: 'string' },
                    example: ['meeting.completed', 'lead.received'],
                  },
                  secret: { type: 'string', description: 'Auto-generated if not provided' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Webhook created' },
        },
      },
    },
    '/reports/revenue': {
      get: {
        tags: ['Reports'],
        summary: 'Get revenue report',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'groupBy', in: 'query', schema: { type: 'string', enum: ['day', 'week', 'month', 'branch', 'course', 'instructor'] } },
        ],
        responses: {
          200: {
            description: 'Revenue report',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        period: { type: 'object' },
                        totals: {
                          type: 'object',
                          properties: {
                            totalRevenue: { type: 'number' },
                            totalInstructorPayment: { type: 'number' },
                            totalProfit: { type: 'number' },
                            meetingCount: { type: 'integer' },
                          },
                        },
                        breakdown: { type: 'array' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/reports/revenue/export': {
      get: {
        tags: ['Reports'],
        summary: 'Export revenue report to CSV',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'groupBy', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'CSV file',
            content: {
              'text/csv': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
        },
      },
    },
  },
};
