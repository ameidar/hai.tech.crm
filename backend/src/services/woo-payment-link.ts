import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { prisma } from '../utils/prisma.js';

type WooAuth = { siteUrl: string; auth: string };
type WooCustomer = { id: number; email?: string; first_name?: string; last_name?: string };

const DIGITAL_COURSE_PRODUCT_ALIASES: Array<{ productId: number; aliases: string[] }> = [
  { productId: 30688, aliases: ['קורס בניית עולמות במיינקראפט', 'קורס למידה עצמית בניית עולמות minecraft באמצעות תכנות', 'minecraft worlds', 'minecraft-worlds'] },
  { productId: 30772, aliases: ['קורס רובלוקס - פיתוח משחקים עם lua', 'משחקי roblox ב-lua', 'רובלוקס lua', 'roblox lua'] },
  { productId: 30857, aliases: ["קורס תכנות בסקראץ'", 'קורס תכנות בסקראץ׳', 'scratch', 'סקראץ'] },
  { productId: 30680, aliases: ['קורס פיתוח משחקים בשפת python', 'קורס למידה עצמית – פיתוח משחקים בשפת python', 'python'] },
  { productId: 30853, aliases: ['קורס מיינקראפט + javascript', 'מיינקראפט javascript גילאי 10+', 'minecraft javascript'] },
  { productId: 30855, aliases: ['minecraft java plugins- לגילאי 12+', 'minecraft java plugins', 'java plugins'] },
  { productId: 39850, aliases: ['קורס מידול תלת מימד - tinkercad', 'tinkercad', 'מידול תלת מימד'] },
  { productId: 39737, aliases: ['קורס קנבה עם בינה מלאכותית', 'קנבה עם בינה מלאכותית', 'canva'] },
  { productId: 35988, aliases: ['קורס פיתוח אתרים ומשחקים בשילוב בינה מלאכותית', 'פיתוח אתרים ומשחקים בשילוב בינה מלאכותית'] },
  { productId: 30770, aliases: ['פיתוח בוטים לשרת דיסקורד node.js - גילאי 12+', 'discord node.js', 'דיסקורד node'] },
  { productId: 30677, aliases: ['קורס למידה עצמית תכנות לבניית מודים במיינקראפט', 'בניית מודים במיינקראפט'] },
];

function normalizeCourseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[׳']/g, '')
    .replace(/[״"]/g, '')
    .replace(/[־–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferDigitalCourseProductId(description: string, amount?: number): number | null {
  const normalized = normalizeCourseText(description);
  if (!normalized) return null;
  for (const item of DIGITAL_COURSE_PRODUCT_ALIASES) {
    if (item.aliases.some((alias) => normalized.includes(normalizeCourseText(alias)))) {
      return item.productId;
    }
  }
  if (Number(amount) === 297 && normalized.includes('מחנה') && normalized.includes('מיינקראפט')) return 39309;
  return null;
}

function buildWooOrderLinePayload(description: string, amount: number, wooProductId?: number | null) {
  if (wooProductId) {
    return {
      line_items: [{
        product_id: wooProductId,
        quantity: 1,
        total: String(Number(amount).toFixed(2)),
      }],
    };
  }

  return {
    fee_lines: [{
      name: description.trim(),
      total: String(Number(amount).toFixed(2)),
    }],
  };
}

async function wooFetchJson<T>(
  { siteUrl, auth }: WooAuth,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${siteUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const bodyText = await res.text();
  let body: any = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = bodyText; }
  if (!res.ok) {
    const message = typeof body === 'string' ? body : body?.message || bodyText;
    throw new Error(`WooCommerce API error (${res.status}): ${message}`);
  }
  return body as T;
}

async function ensureWooCustomerId(
  woo: WooAuth,
  email: string,
  firstName: string,
  lastName: string,
  phone?: string
): Promise<number | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  try {
    const existing = await wooFetchJson<WooCustomer[]>(
      woo,
      `/wp-json/wc/v3/customers?email=${encodeURIComponent(normalizedEmail)}`
    );
    if (existing[0]?.id) return existing[0].id;

    const created = await wooFetchJson<WooCustomer>(woo, '/wp-json/wc/v3/customers', {
      method: 'POST',
      body: JSON.stringify({
        email: normalizedEmail,
        first_name: firstName,
        last_name: lastName,
        billing: {
          first_name: firstName,
          last_name: lastName,
          email: normalizedEmail,
          phone: phone || '',
        },
      }),
    });
    return created.id || null;
  } catch (error) {
    console.warn('[payments/create-link] Could not resolve Woo customer, creating guest order:', error);
    return null;
  }
}

export interface CreateWooPaymentLinkInput {
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  amount: number;
  description: string;
  installments?: number | null;
  wooProductId?: number | null;
  baseUrl?: string;
}

export async function createWooPaymentLink(input: CreateWooPaymentLinkInput) {
  const maxInstallments = input.installments && Number(input.installments) > 1 ? Number(input.installments) : 1;
  if (!input.amount || isNaN(Number(input.amount)) || Number(input.amount) <= 0) {
    throw new Error('סכום לא תקין');
  }
  if (!input.description?.trim()) {
    throw new Error('נדרש תיאור');
  }

  const { siteUrl, consumerKey, consumerSecret } = config.woo;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const woo = { siteUrl, auth };

  const nameParts = (input.customerName || 'לקוח').trim().split(' ');
  const firstName = nameParts[0] || 'לקוח';
  const lastName = nameParts.slice(1).join(' ') || '';
  const normalizedEmail = String(input.customerEmail || '').trim().toLowerCase();
  const resolvedWooCustomerId = normalizedEmail
    ? await ensureWooCustomerId(woo, normalizedEmail, firstName, lastName, input.customerPhone || undefined)
    : null;
  const requestedProductId = Number(input.wooProductId);
  const productId = Number.isInteger(requestedProductId) && requestedProductId > 0
    ? requestedProductId
    : inferDigitalCourseProductId(input.description.trim(), Number(input.amount));

  const orderPayload: any = {
    payment_method: 'greeninvoice-creditcard',
    payment_method_title: 'כרטיס אשראי / ביט',
    status: 'pending',
    ...(resolvedWooCustomerId ? { customer_id: resolvedWooCustomerId } : {}),
    billing: {
      first_name: firstName,
      last_name: lastName,
      email: normalizedEmail || 'noreply@haitech.co.il',
      phone: input.customerPhone || '',
    },
    meta_data: productId ? [{ key: 'haitech_crm_digital_product_id', value: String(productId) }] : [],
    ...buildWooOrderLinePayload(input.description.trim(), Number(input.amount), productId),
  };

  const wooRes = await fetch(`${siteUrl}/wp-json/wc/v3/orders`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload),
  });

  if (!wooRes.ok) {
    const errText = await wooRes.text();
    console.error('WooCommerce order error:', errText);
    throw new Error(`שגיאה ביצירת הזמנה ב-WooCommerce: ${errText}`);
  }

  const order = (await wooRes.json()) as { id: number; order_key: string };

  let resolvedCustomerId = input.customerId || null;
  if (!resolvedCustomerId && input.customerPhone) {
    const normalizedPhone = input.customerPhone.replace(/\D/g, '');
    const found = await prisma.customer.findFirst({
      where: {
        phone: { contains: normalizedPhone.slice(-9) },
      },
      select: { id: true },
    });
    if (found) resolvedCustomerId = found.id;
  }

  const payToken = randomUUID();
  const baseUrl = input.baseUrl || process.env.BASE_URL || 'https://crm.orma-ai.com';

  const payment = await prisma.payment.create({
    data: {
      customerId: resolvedCustomerId,
      customerName: input.customerName || 'לקוח',
      customerEmail: input.customerEmail || null,
      customerPhone: input.customerPhone || null,
      description: input.description.trim(),
      amount: Number(input.amount),
      currency: 'ILS',
      wooOrderId: order.id,
      wooOrderKey: order.order_key,
      status: 'pending',
      payToken,
      maxInstallments: maxInstallments > 1 ? maxInstallments : null,
    },
  });

  const crmPayUrl = `${baseUrl}/pay/${payToken}`;
  const directPaymentUrl = `${siteUrl}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${order.order_key}`;

  return {
    paymentId: payment.id,
    orderId: order.id,
    orderKey: order.order_key,
    paymentUrl: crmPayUrl,
    directPaymentUrl,
    amount: Number(input.amount),
    description: input.description.trim(),
    maxInstallments,
    wooProductId: productId,
    wooCustomerId: resolvedWooCustomerId,
  };
}
