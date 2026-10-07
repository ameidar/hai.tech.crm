/**
 * OpenAPI paths for the ops/admin endpoints (v1.62.0).
 * Merged into openApiSpec.paths in openapi.ts.
 *
 * Every operation documents its scope in `x-required-scope`. API keys are authorized by
 * scope only (the key creator's role is ignored); JWT users by the same roles as the CRM UI.
 */

const security = [{ apiKey: [] }, { bearerAuth: [] }];

const idParam = (name = 'id', description = 'Record id (UUID or imported CUID)') => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description,
});

const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
];

const jsonBody = (schema: Record<string, unknown>, required = true) => ({
  required,
  content: { 'application/json': { schema } },
});

const errors = {
  400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  401: { description: 'Missing/invalid credentials' },
  403: { description: 'Missing required scope (API key) or role (JWT)' },
  404: { description: 'Not found' },
  429: { description: 'Rate limit exceeded (per API key: the key\'s rateLimit per hour)' },
};

const op = (
  tag: string,
  scope: string,
  summary: string,
  extra: Record<string, unknown> = {},
  okStatus: number = 200,
) => ({
  tags: [tag],
  summary,
  description: `Required scope: \`${scope}\`${extra.description ? `\n\n${extra.description}` : ''}`,
  security,
  'x-required-scope': scope,
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'description')),
  responses: { [okStatus]: { description: 'OK' }, ...errors },
});

const institutionalOrderBody = {
  type: 'object',
  properties: {
    branchId: { type: 'string', description: 'Required on create' },
    payingBodyId: { type: 'string', description: 'Required on create' },
    orderName: { type: 'string', nullable: true },
    orderNumber: { type: 'string', nullable: true },
    orderDate: { type: 'string', format: 'date', nullable: true },
    startDate: { type: 'string', format: 'date', nullable: true },
    endDate: { type: 'string', format: 'date', nullable: true },
    pricePerMeeting: { type: 'number', nullable: true },
    estimatedMeetings: { type: 'integer', nullable: true },
    estimatedTotal: { type: 'number', nullable: true },
    contactName: { type: 'string', nullable: true },
    contactPhone: { type: 'string', nullable: true },
    contactEmail: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['draft', 'active', 'completed', 'cancelled'] },
    notes: { type: 'string', nullable: true },
    totalAmount: { type: 'number', nullable: true },
    paymentStatus: { type: 'string', enum: ['unpaid', 'partial', 'paid'], nullable: true, description: 'Update only' },
    paidAmount: { type: 'number', nullable: true, description: 'Update only' },
    invoiceNumber: { type: 'string', nullable: true, description: 'Update only' },
    paymentTermsDays: { type: 'integer', minimum: 0 },
    salesperson: { type: 'string', nullable: true },
    orderType: { type: 'string', nullable: true },
    taxId: { type: 'string', nullable: true },
    address: { type: 'string', nullable: true },
    city: { type: 'string', nullable: true },
    zip: { type: 'string', nullable: true },
  },
};

const payingBodyBody = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Required on create' },
    taxId: { type: 'string', description: 'ח.פ / ת.ז — required on create' },
    contactName: { type: 'string', description: 'Required on create' },
    email: { type: 'string', format: 'email', description: 'Required on create' },
    phone: { type: 'string', nullable: true },
    address: { type: 'string', nullable: true },
    city: { type: 'string', nullable: true },
    zip: { type: 'string', nullable: true },
    morningClientId: { type: 'string', nullable: true },
  },
};

const fixedAdditionBody = {
  type: 'object',
  properties: {
    description: { type: 'string', maxLength: 200 },
    amount: { type: 'number', exclusiveMinimum: 0 },
    isNet: { type: 'boolean', default: true, description: 'true = נטו, false = ברוטו' },
    startMonth: { type: 'string', example: '2026-10', description: 'YYYY-MM' },
    endMonth: { type: 'string', nullable: true, example: '2027-06', description: 'YYYY-MM, inclusive; null = open-ended' },
    notes: { type: 'string', nullable: true },
  },
};

const meetingSelectorProps = {
  ids: { type: 'array', items: { type: 'string' }, maxItems: 1000 },
  cycleId: { type: 'string', description: 'Alternative to ids: all non-deleted meetings of the cycle' },
  statuses: { type: 'array', items: { type: 'string', enum: ['scheduled', 'completed', 'cancelled', 'postponed'] }, description: 'With cycleId only' },
  fromDate: { type: 'string', format: 'date', description: 'With cycleId only (inclusive)' },
  toDate: { type: 'string', format: 'date', description: 'With cycleId only (inclusive)' },
};

export const opsTags = [
  { name: 'Institutional Orders', description: 'הזמנות מוסדיות (ops API)' },
  { name: 'Paying Bodies', description: 'גופים משלמים (ops API)' },
  { name: 'Bot Config', description: 'WhatsApp bot system prompt + knowledge base (explicit-only scopes)' },
  { name: 'Instructor Additions', description: 'תוספות קבועות למדריכים (ops API)' },
];

export const opsPaths = {
  '/institutional-orders': {
    get: op('Institutional Orders', 'read:institutional_orders', 'List institutional orders', {
      parameters: [
        ...pageParams,
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'active', 'completed', 'cancelled'] } },
        { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Order name/number, contact, paying body, branch' },
        { name: 'withCycles', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        { name: 'withRelevantCycles', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        { name: 'forBilling', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
      ],
    }),
    post: op('Institutional Orders', 'write:institutional_orders', 'Create institutional order', {
      description: 'branchId and payingBodyId are required.',
      requestBody: jsonBody({ ...institutionalOrderBody, required: ['branchId', 'payingBodyId'] }),
    }, 201),
  },
  '/institutional-orders/{id}': {
    get: op('Institutional Orders', 'read:institutional_orders', 'Get institutional order (with cycles)', { parameters: [idParam()] }),
    put: op('Institutional Orders', 'write:institutional_orders', 'Update institutional order (partial)', {
      parameters: [idParam()],
      requestBody: jsonBody(institutionalOrderBody),
    }),
  },
  '/paying-bodies': {
    get: op('Paying Bodies', 'read:paying_bodies', 'List / search paying bodies', {
      parameters: [
        ...pageParams,
        { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Substring of name or taxId' },
        { name: 'incomplete', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
      ],
    }),
    post: op('Paying Bodies', 'write:paying_bodies', 'Create paying body', {
      description: 'name, taxId, contactName and email are required. No Morning sync.',
      requestBody: jsonBody({ ...payingBodyBody, required: ['name', 'taxId', 'contactName', 'email'] }),
    }, 201),
  },
  '/paying-bodies/{id}': {
    get: op('Paying Bodies', 'read:paying_bodies', 'Get paying body', { parameters: [idParam()] }),
    put: op('Paying Bodies', 'write:paying_bodies', 'Update paying body (all fields optional; isComplete recomputed)', {
      parameters: [idParam()],
      requestBody: jsonBody(payingBodyBody),
    }),
  },
  '/bot-config': {
    get: op('Bot Config', 'read:bot_config', 'Get system prompt, raw knowledge base and live load status'),
    put: op('Bot Config', 'write:bot_config', 'Update system prompt and/or knowledge base (applied live)', {
      description: 'knowledgeBase: JSON string or object; must be a JSON object. Invalid JSON → 400, nothing written.',
      requestBody: jsonBody({
        type: 'object',
        properties: {
          systemPrompt: { type: 'string' },
          knowledgeBase: { oneOf: [{ type: 'string' }, { type: 'object' }] },
        },
      }),
    }),
  },
  '/bot-config/status': {
    get: op('Bot Config', 'read:bot_config', 'Live knowledge-base status', {
      description: 'knowledgeBase.parsed=false or inSync=false means the bot is NOT using the stored KB text (e.g. DB value is not valid JSON and the file KB is used).',
    }),
  },
  '/instructors/{id}/fixed-additions': {
    get: op('Instructor Additions', 'read:instructor_additions', 'List fixed monthly additions of an instructor', { parameters: [idParam()] }),
    post: op('Instructor Additions', 'write:instructor_additions', 'Create fixed monthly addition', {
      parameters: [idParam()],
      requestBody: jsonBody({ ...fixedAdditionBody, required: ['description', 'amount', 'startMonth'] }),
    }, 201),
  },
  '/instructors/{id}/fixed-additions/{additionId}': {
    put: op('Instructor Additions', 'write:instructor_additions', 'Update fixed monthly addition (set endMonth to end it)', {
      parameters: [idParam(), idParam('additionId', 'Addition id')],
      requestBody: jsonBody(fixedAdditionBody),
    }),
    delete: op('Instructor Additions', 'write:instructor_additions', 'Delete (soft) fixed monthly addition', {
      parameters: [idParam(), idParam('additionId', 'Addition id')],
    }, 204),
  },
  '/reports/instructor-salaries': {
    get: op('Reports', 'read:salary_reports', 'Monthly instructor salary report', {
      description: 'Same report as the CRM instructors report (meetings, payments incl. manual overrides, expenses, fixed additions, operations staff, totals). Defaults to the previous month.',
      parameters: [{ name: 'month', in: 'query', schema: { type: 'string', example: '2026-09' }, description: 'YYYY-MM' }],
    }),
  },
  '/cycles': {
    post: op('Cycles', 'write:cycles', 'Create cycle (same logic as CRM UI; generates meetings)', {
      description: 'Institutional types (institutional_per_child / institutional_fixed) require institutionalOrderId. Frontal cycles require location. endDate auto-calculated (holiday aware) when omitted.',
      requestBody: jsonBody({ type: 'object', required: ['name', 'courseId', 'branchId', 'instructorId', 'type', 'startDate', 'dayOfWeek', 'startTime', 'endTime', 'durationMinutes', 'totalMeetings'] }),
    }, 201),
  },
  '/cycles/{id}': {
    put: op('Cycles', 'write:cycles', 'Update cycle (same logic as CRM UI)', {
      description: 'Supports totalMeetings, meetingRevenue, endDate, type, institutionalOrderId, status, … Send regenerateMeetings: true to rebuild the open schedule.',
      parameters: [idParam()],
      requestBody: jsonBody({ type: 'object' }),
    }),
  },
  '/meetings/bulk-update': {
    post: op('Meetings', 'write:meetings', 'Bulk update meetings (by ids or by cycle)', {
      description: 'data.revenue / data.instructorPayment set manual amounts (profit = revenue − instructorPayment − approved expenses); refused (423) for meetings in an invoiced billing period; not combinable with data.status.',
      requestBody: jsonBody({
        type: 'object',
        required: ['data'],
        properties: {
          ...meetingSelectorProps,
          data: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['scheduled', 'completed', 'cancelled', 'postponed'] },
              activityType: { type: 'string', enum: ['online', 'frontal', 'private_lesson'] },
              topic: { type: 'string', nullable: true },
              notes: { type: 'string', nullable: true },
              scheduledDate: { type: 'string', format: 'date' },
              startTime: { type: 'string', example: '16:30' },
              endTime: { type: 'string', example: '17:30' },
              instructorId: { type: 'string' },
              registrationId: { type: 'string', nullable: true },
              revenue: { type: 'number', minimum: 0 },
              instructorPayment: { type: 'number', minimum: 0 },
            },
          },
        },
      }),
    }),
  },
  '/meetings/bulk-recalculate': {
    post: op('Meetings', 'write:meetings', 'Recalculate financials of completed meetings (by ids or by cycle)', {
      requestBody: jsonBody({ type: 'object', properties: { ...meetingSelectorProps, force: { type: 'boolean', default: false } } }),
    }),
  },
  '/meetings/bulk-update-status': {
    post: op('Meetings', 'write:meetings', 'Bulk update meeting status', {
      requestBody: jsonBody({
        type: 'object',
        required: ['ids', 'status'],
        properties: { ids: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['scheduled', 'completed', 'cancelled', 'postponed'] } },
      }),
    }),
  },
  '/meetings/bulk-delete': {
    post: op('Meetings', 'write:meetings', 'Bulk delete meetings (hard delete, same as CRM UI; billing-lock aware)', {
      requestBody: jsonBody({ type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' } } } }),
    }),
  },
};
