import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { prisma } from './utils/prisma.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { customersRouter } from './routes/customers.js';
import { studentsRouter } from './routes/students.js';
import { coursesRouter } from './routes/courses.js';
import { lessonAiRouter } from './routes/lesson-ai.js';
import { branchesRouter } from './routes/branches.js';
import { instructorsRouter } from './routes/instructors.js';
import { inviteRouter } from './routes/invite.js';
import { cyclesRouter } from './routes/cycles.js';
import { meetingsRouter } from './routes/meetings.js';
import { registrationsRouter } from './routes/registrations.js';
import { attendanceRouter } from './routes/attendance.js';
import { webhookRouter } from './routes/webhook.js';
import { publicMeetingRouter } from './routes/public-meeting.js';
import { auditRouter } from './routes/audit.js';
import { versionRouter } from './routes/version.js';
import { viewsRouter } from './routes/views.js';
import { communicationRouter } from './routes/communication.js';
import zoomRouter from './routes/zoom.js';
import zoomWebhookRouter from './routes/zoom-webhook.js';
import { instructorMagicRouter } from './routes/instructor-magic.js';
import { parentAppRouter } from './routes/parent-app.js';
import { messagingRouter } from './routes/messaging.js';
import expensesRouter from './routes/expenses.js';
import { emailRouter } from './routes/email.js';
import { initEmailQueue } from './services/email/queue.js';
import { initEmailScheduler } from './services/email/scheduler.js';
import { initCancellationScheduler } from './services/cancellation-scheduler.js';
import { initBillingScheduler } from './services/billing-scheduler.js';
import { initProformaAlertScheduler } from './services/proforma-alerts.js';
import { forecastRouter } from './routes/forecast.js';
import { quotesRouter } from './routes/quotes.js';
import { publicQuoteRouter } from './routes/public-quote.js';
import { publicCancelRouter } from './routes/public-cancel.js';
import { vapiWebhookRouter } from './routes/vapi-webhook.js';
import { morningWebhookRouter } from './routes/morning-webhook.js';
import { morningRouter } from './routes/morning.js';
import { billingRouter } from './routes/billing.js';
import { vapiToolsRouter } from './routes/vapi-tools.js';
import { upsellLeadsRouter } from './routes/upsell-leads.js';
import { reportsRouter } from './routes/reports.js';
import { workHoursRouter } from './routes/work-hours.js';
import { leadAppointmentsRouter } from './routes/lead-appointments.js';
import { institutionalOrdersRouter } from './routes/institutional-orders.js';
import { meetingRequestsRouter } from './routes/meeting-requests.js';
import { filesRouter } from './routes/files.js';
import { systemUsersRouter } from './routes/system-users.js';
import waRouter from './routes/whatsapp.js';
import { messengerRouter } from './routes/messenger.js';
import { instagramRouter } from './routes/instagram.js';
import { paymentsRouter } from './routes/payments.js';
import { ensureMorningClientId, paymentLinksRouter } from './routes/payment-links.js';
import { campaignsRouter } from './routes/campaigns.js';
import { campaignLeadsRouter } from './routes/campaign-leads.js';
import { facebookLeadsRouter } from './routes/facebook-leads.js';
import analyticsRouter from './routes/analytics.js';
import linkedinRouter from './routes/linkedin.js';
import socialRouter from './routes/social.js';
import { googleAdsRouter } from './routes/google-ads.js';
import { devReadOnly } from './middleware/devReadOnly.js';
import { createPaymentForm } from './services/morning/payment-forms.js';

// API v1 Router
import { apiV1Router } from './api/v1/index.js';


const app = express();

// Security middleware - disabled for HTTP dev access
app.use(helmet({
  contentSecurityPolicy: false,
  strictTransportSecurity: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
}));
// Permissive CORS for Vapi webhook (no auth)
app.use('/api/vapi-webhook', cors({
  origin: '*',
  credentials: false,
  allowedHeaders: ['Content-Type'],
  methods: ['POST', 'OPTIONS'],
}));

// Permissive CORS for Vapi tools (no auth)
app.use('/api/vapi-tools', cors({
  origin: '*',
  credentials: false,
  allowedHeaders: ['Content-Type'],
  methods: ['POST', 'OPTIONS'],
}));

// Permissive CORS for webhook routes (API key protected)
app.use('/api/webhook', cors({
  origin: '*',
  credentials: false,
  allowedHeaders: ['Content-Type', 'X-API-Key'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Regular CORS for other routes
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Rate limiting with per-user tracking when authenticated
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // limit each IP/user to 1000 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  // Use userId when available for more accurate rate limiting
  keyGenerator: (req) => {
    // Check for authenticated user in JWT
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, config.jwt.secret) as { userId: string };
        if (decoded.userId) {
          return `user:${decoded.userId}`;
        }
      } catch {
        // Token invalid or expired, fall back to IP
      }
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

// Dev read-only protection: non-admin users cannot write in non-production environments
app.use(devReadOnly);

// =============================================================================
// API v1 Routes (new versioned API layer)
// =============================================================================
app.use('/api/v1', apiV1Router);

// =============================================================================
// Legacy Routes (existing, backward compatible)
// =============================================================================

// Health check with database connectivity test
app.get('/api/health', async (_req, res) => {
  const health: {
    status: 'ok' | 'degraded' | 'error';
    timestamp: string;
    version: string;
    database: 'connected' | 'disconnected';
  } = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    database: 'disconnected',
  };

  try {
    // Test database connectivity with a simple query
    await prisma.$queryRaw`SELECT 1`;
    health.database = 'connected';
  } catch (error) {
    health.status = 'degraded';
    health.database = 'disconnected';
    console.error('Health check: Database connection failed', error);
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/invite', inviteRouter); // Public invite endpoints
app.use('/api/meeting-status', publicMeetingRouter); // Public meeting status updates
app.use('/api/customers', customersRouter);
app.use('/api/students', studentsRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/lesson-ai', lessonAiRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/instructors', instructorsRouter);
app.use('/api/messaging', messagingRouter);
app.use('/api/cycles', cyclesRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/registrations', registrationsRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/audit', auditRouter);
app.use('/api/version', versionRouter);
app.use('/api/views', viewsRouter);
app.use('/api/webhook', webhookRouter);
app.use('/api/communication', communicationRouter);
app.use('/api/zoom', zoomRouter);
app.use('/api/zoom-webhook', zoomWebhookRouter);
app.use('/api/instructor-magic', instructorMagicRouter);
app.use('/api/parent', parentAppRouter); // Parent mobile app API
app.use('/api/expenses', expensesRouter); // Expense tracking
app.use('/api/email', emailRouter); // Email service
app.use('/api/forecast', forecastRouter); // Financial forecasting
app.use('/api/public/quotes', publicQuoteRouter); // Public quote view (no auth)
app.use('/api/public/cancel', publicCancelRouter); // Public cancellation form (no auth)
app.use('/api/quotes', quotesRouter); // Quote management
app.use('/api/vapi-webhook', vapiWebhookRouter); // Vapi AI webhook (no auth)
app.use('/api/vapi-tools', vapiToolsRouter); // Vapi AI tool calls - Google Calendar (no auth)
app.use('/api/morning-webhook', morningWebhookRouter); // Morning (GreenInvoice) payment webhook (no auth)
app.use('/api/morning', morningRouter);                   // Morning outgoing — issue documents
app.use('/api/billing', billingRouter);                   // Monthly billing periods for institutions
app.use('/api/messenger/webhook', cors({ origin: '*', credentials: false, methods: ['GET', 'POST', 'OPTIONS'] }));
app.use('/api/instagram/webhook', cors({ origin: '*', credentials: false, methods: ['GET', 'POST', 'OPTIONS'] }));
app.use('/api/lead-appointments', leadAppointmentsRouter); // Lead appointment management
app.use('/api/institutional-orders', institutionalOrdersRouter); // Institutional orders
app.use('/api/meeting-requests', meetingRequestsRouter); // Meeting change requests
app.use('/api/files', filesRouter); // File attachments (instructors, quotes)
app.use('/api/wa', waRouter); // WhatsApp Cloud API inbox
app.use('/api/messenger', messengerRouter); // Facebook Messenger inbox
app.use('/api/instagram', instagramRouter); // Instagram DM inbox
app.use('/api/payments', paymentsRouter); // WooCommerce payment links
app.use('/api/payment-links', paymentLinksRouter); // Morning hosted payment forms
app.use('/api/system-users', systemUsersRouter); // System users management (admin/manager)
app.use('/api/upsell-leads', upsellLeadsRouter); // Upsell leads from completed cycles
app.use('/api/reports', reportsRouter); // Instructor activity reports
app.use('/api/work-hours', workHoursRouter); // Operations staff self-reported work hours
app.use('/api/campaigns', campaignsRouter); // Marketing campaigns
app.use('/api/campaign-leads', campaignLeadsRouter); // Public campaign lead form submissions
app.use('/api/facebook', facebookLeadsRouter);     // Facebook Lead Ads
app.use('/api/analytics', analyticsRouter);       // Google Analytics Data API
app.use('/api/linkedin', linkedinRouter);         // LinkedIn integration
app.use('/api/social', socialRouter);             // Social media AI generator + publisher
app.use('/api/google-ads', googleAdsRouter);      // Google Ads campaigns

// Error handling for API routes
app.use('/api', errorHandler);

// Public short-link landing: /pl/<code> → preview page with payment details,
// then a "המשך לתשלום" button to the Morning/Meshulam hosted checkout URL.
// `?go=1` keeps the legacy direct-redirect behavior for anyone who wants to skip the preview.
// No auth — this is the link we share with end-customers.

function normalizePaymentPhone(phone?: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return `972${digits}`;
}

async function recordPaidPaymentLink(code: string) {
  const link = await prisma.paymentLink.findUnique({ where: { code } });
  if (!link) return null;

  const marker = `[payment-link:${link.code}]`;
  const existing = await prisma.payment.findFirst({
    where: { description: { contains: marker } },
    include: { customer: { select: { id: true, name: true } } },
  });
  if (existing) return { link, payment: existing, customer: existing.customer, created: false, duplicate: true };

  const customerPhone = normalizePaymentPhone(link.clientPhone);
  const customerEmail = (link.clientEmail || '').trim();
  let customer = link.customerId
    ? await prisma.customer.findUnique({ where: { id: link.customerId } })
    : null;

  if (!customer && customerPhone) {
    customer = await prisma.customer.findFirst({
      where: { deletedAt: null, phone: { contains: customerPhone.slice(-9) } },
    });
  }
  if (!customer && customerEmail) {
    customer = await prisma.customer.findFirst({
      where: { deletedAt: null, email: customerEmail },
    });
  }

  let createdCustomer = false;
  if (!customer) {
    createdCustomer = true;
    customer = await prisma.customer.create({
      data: {
        name: link.clientName || 'לקוח',
        phone: customerPhone || null,
        email: customerEmail || null,
        source: 'payment_link',
      },
    });
  } else {
    const patch: Record<string, string> = {};
    if (!customer.phone && customerPhone) patch.phone = customerPhone;
    if (!customer.email && customerEmail) patch.email = customerEmail;
    if (Object.keys(patch).length > 0) {
      customer = await prisma.customer.update({ where: { id: customer.id }, data: patch });
    }
  }

  if (!link.customerId) {
    await prisma.paymentLink.update({ where: { id: link.id }, data: { customerId: customer.id } });
  }

  const payment = await prisma.payment.create({
    data: {
      customerId: customer.id,
      customerName: customer.name || link.clientName || 'לקוח',
      customerPhone: customerPhone || null,
      customerEmail: customerEmail || null,
      description: `${link.description} ${marker}`,
      amount: Number(link.amount),
      currency: 'ILS',
      status: 'paid',
      paymentMethod: 'payment_link_success',
      paidAt: new Date(),
    },
  });

  return { link, payment, customer, created: createdCustomer, duplicate: false };
}

app.get('/pl/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').toLowerCase().slice(0, 16);
    if (!/^[a-z0-9]{3,16}$/.test(code)) return res.status(404).send('Not found');
    const link = await prisma.paymentLink.findUnique({ where: { code } });
    if (!link) return res.status(404).send('Not found');
    prisma.paymentLink
      .update({ where: { id: link.id }, data: { clicks: { increment: 1 }, lastClickedAt: new Date() } })
      .catch(() => {}); // fire-and-forget; never block on stats

    if (req.query.go === '1') return res.redirect(302, link.morningUrl);

    const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
    const docTypeLabel: Record<number, string> = {
      400: 'קבלה',
      320: 'חשבונית מס + קבלה',
      305: 'חשבונית מס',
    };
    const amountNum = Number(link.amount);
    const amountStr = amountNum.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const paymentsStr = link.maxPayments > 1 ? `עד ${link.maxPayments} תשלומים` : 'תשלום אחד';
    const docStr = docTypeLabel[link.documentType] || `מסמך ${link.documentType}`;
    const checkoutUrl = escapeHtml(link.morningUrl);
    const installmentOptions = Array.from({ length: Math.max(1, Math.min(36, link.maxPayments)) }, (_, i) => i + 1);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>תשלום • דרך ההייטק</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Rubik", "Heebo", Arial, sans-serif;
    background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: #0f172a;
  }
  .card {
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08);
    width: 100%;
    max-width: 480px;
    padding: 32px 28px;
    text-align: center;
  }
  .logo {
    max-width: 180px;
    height: auto;
    margin: 0 auto 20px;
    display: block;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    margin: 0 0 6px;
    color: #1e3a8a;
  }
  .subtitle {
    font-size: 14px;
    color: #64748b;
    margin: 0 0 24px;
  }
  .amount-block {
    background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
    color: #ffffff;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
  }
  .amount-label { font-size: 13px; opacity: 0.85; margin-bottom: 4px; }
  .amount-value { font-size: 36px; font-weight: 700; line-height: 1.1; }
  .amount-payments { font-size: 13px; opacity: 0.9; margin-top: 6px; }
  .details {
    text-align: right;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 24px;
    background: #f8fafc;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 8px 0;
    border-bottom: 1px solid #e2e8f0;
    gap: 12px;
  }
  .row:last-child { border-bottom: 0; }
  .row .label { color: #64748b; font-size: 13px; flex-shrink: 0; }
  .row .value { color: #0f172a; font-size: 14px; font-weight: 500; text-align: left; }
  .cta {
    display: block;
    width: 100%;
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    color: #ffffff;
    text-decoration: none;
    padding: 14px 18px;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 600;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
  }
  .cta:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(37, 99, 235, 0.45); }
  .secure {
    margin-top: 14px;
    font-size: 12px;
    color: #64748b;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .secure svg { width: 14px; height: 14px; }
  .installments { margin: 0 0 22px; text-align: right; }
  .installments-label { font-size: 13px; font-weight: 600; color: #334155; margin: 0 0 10px; }
  .installment-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); gap: 8px; }
  .installment-option {
    border: 1px solid #bfdbfe;
    background: #eff6ff;
    color: #1d4ed8;
    border-radius: 10px;
    padding: 10px 8px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .installment-option:hover { background: #dbeafe; border-color: #93c5fd; }
</style>
</head>
<body>
  <div class="card">
    <img src="/logo.png" alt="דרך ההייטק" class="logo" />
    <h1>פרטי התשלום</h1>
    <p class="subtitle">שלום ${escapeHtml(link.clientName)}, להלן פרטי התשלום</p>

    <div class="amount-block">
      <div class="amount-label">סכום לתשלום</div>
      <div class="amount-value">₪${amountStr}</div>
      <div class="amount-payments">${paymentsStr}</div>
    </div>

    <div class="details">
      <div class="row">
        <span class="label">תיאור</span>
        <span class="value">${escapeHtml(link.description)}</span>
      </div>
      <div class="row">
        <span class="label">מסמך שיופק</span>
        <span class="value">${escapeHtml(docStr)}</span>
      </div>
    </div>

    ${link.maxPayments > 1 ? `
    <form class="installments" method="post" action="/pl/${escapeHtml(code)}/pay">
      <p class="installments-label">בחר/י מספר תשלומים — עד ${link.maxPayments}</p>
      <div class="installment-grid">
        ${installmentOptions.map(n => `<button class="installment-option" type="submit" name="payments" value="${n}">${n === 1 ? 'תשלום אחד' : `${n} תשלומים`}</button>`).join('')}
      </div>
    </form>` : `
    <a class="cta" href="${checkoutUrl}">המשך לתשלום מאובטח ←</a>`}
    <div class="secure">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
      סליקה מאובטחת באמצעות Meshulam
    </div>
  </div>
</body>
</html>`);
  } catch (e) { next(e); }
});

app.post('/pl/:code/pay', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').toLowerCase().slice(0, 16);
    if (!/^[a-z0-9]{3,16}$/.test(code)) return res.status(404).send('Not found');

    const link = await prisma.paymentLink.findUnique({ where: { code } });
    if (!link) return res.status(404).send('Not found');

    const payments = Number(req.body?.payments || 1);
    if (!Number.isInteger(payments) || payments < 1 || payments > link.maxPayments || payments > 36) {
      return res.status(400).send('Invalid payment count');
    }

    let morningClientId: string | undefined;
    if (link.customerId) {
      const resolved = await ensureMorningClientId(link.customerId);
      if (resolved) morningClientId = resolved;
    }

    const result = await createPaymentForm({
      description: link.description,
      amount: Number(link.amount),
      maxPayments: payments,
      vatType: link.vatType as 0 | 1 | 2,
      type: link.documentType,
      client: {
        id: morningClientId,
        name: link.clientName,
        emails: link.clientEmail ? [link.clientEmail] : undefined,
        phone: link.clientPhone || undefined,
        taxId: link.clientTaxId || undefined,
      },
      notifyUrl: `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${req.get('host')}/api/morning-webhook?paymentLinkCode=${encodeURIComponent(link.code)}`,
      successUrl: `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${req.get('host')}/pl/${encodeURIComponent(link.code)}/success`,
      failureUrl: `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${req.get('host')}/pl/${encodeURIComponent(link.code)}?failed=1`,
    });

    return res.redirect(302, result.url);
  } catch (e) { next(e); }
});

app.get('/pl/:code/success', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').toLowerCase().slice(0, 16);
    if (!/^[a-z0-9]{3,16}$/.test(code)) return res.status(404).send('Not found');

    const result = await recordPaidPaymentLink(code);
    if (!result) return res.status(404).send('Not found');

    const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
    const amountStr = Number(result.link.amount).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>התשלום התקבל • דרך ההייטק</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: linear-gradient(135deg, #ecfdf5 0%, #dbeafe 100%); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #0f172a; }
  .card { width: 100%; max-width: 460px; background: white; border-radius: 18px; box-shadow: 0 10px 40px rgba(15, 23, 42, .10); padding: 34px 28px; text-align: center; }
  .ok { width: 68px; height: 68px; border-radius: 999px; background: #dcfce7; color: #16a34a; display: flex; align-items: center; justify-content: center; margin: 0 auto 18px; font-size: 38px; }
  h1 { margin: 0 0 8px; font-size: 24px; color: #166534; }
  p { margin: 8px 0; color: #475569; }
  .amount { margin: 18px 0; font-size: 30px; font-weight: 800; color: #2563eb; }
  .small { font-size: 13px; color: #64748b; }
</style>
</head>
<body>
  <div class="card">
    <div class="ok">✓</div>
    <h1>התשלום התקבל</h1>
    <p>תודה ${escapeHtml(result.customer?.name || result.link.clientName || '')}</p>
    <div class="amount">₪${amountStr}</div>
    <p>${escapeHtml(result.link.description)}</p>
    <p class="small">התשלום עודכן במערכת דרך ההייטק.</p>
  </div>
</body>
</html>`);
  } catch (e) { next(e); }
});

// Serve static frontend files
const frontendPath = path.join(process.cwd(), 'frontend-dist');
app.use(express.static(frontendPath, {
  index: false, // Disable auto index.html serving, we handle it in SPA fallback
  setHeaders: (res, filePath) => {
    // Don't cache HTML files
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('CDN-Cache-Control', 'no-store');
      res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
      res.setHeader('Surrogate-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// SPA fallback - serve index.html for all non-API routes (no cache!)
// Generate unique ETag based on server start time to force cache invalidation
const serverStartTime = Date.now().toString(36);
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('ETag', `"${serverStartTime}"`);
  res.setHeader('Last-Modified', new Date().toUTCString());
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start server
const start = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected');

    // Initialize email services
    initEmailQueue();
    if (process.env.DISABLE_CRON === 'true') {
      console.log('⚠️  DISABLE_CRON=true — schedulers disabled (dev mode)');
    } else {
      initEmailScheduler();
      initCancellationScheduler();
      initBillingScheduler();
      initProformaAlertScheduler();
    }

    app.listen(config.port, () => {
      console.log(`🚀 HaiTech CRM API running on port ${config.port}`);
      console.log(`🌿 Branch: dev | build: ${new Date().toISOString().slice(0,10)}`);
      console.log(`📍 Health check: http://localhost:${config.port}/api/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

start();
