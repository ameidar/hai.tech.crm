import { morningRequest } from './client.js';
import { DOCUMENT_TYPES, VatType, type MorningIncomeItem } from './documents.js';

// API reference (official OpenAPI): https://developers.morning.co/api — operation
// `getPaymentForm`, POST /api/v1/payments/form. Spec bundle:
// https://developers.morning.co/docs/openapi.bundled.json

// Morning payment-form creates a hosted payment link (Meshulam-backed by default).
// Requires a `pluginId` from /api/v1/plugins — typically the active credit-card plugin.
// Default is read from env MORNING_PAYMENT_PLUGIN_ID; if missing the call will 400.

export interface CreatePaymentFormInput {
  description: string;
  amount: number;
  maxPayments?: number;          // 1..36 split-payments
  vatType?: VatType;             // see documents.ts — defaults to 0 (price excludes VAT)
  type?: number;                 // document type Morning issues on success; default 400 (קבלה)
  lang?: 'he' | 'en';
  currency?: string;
  pluginId?: string;             // override the env default
  client: {
    id?: string;                 // pre-resolved Morning client UUID — when set, Morning
                                 // attaches the issued document to that client.
    name: string;
    emails?: string[];
    phone?: string;
    taxId?: string;
    address?: string;
    city?: string;
    add?: boolean;               // upsert into Morning's client directory ("הוספה ללקוחות")
  };
  // Optional income rows. Per the payments/form spec, income vatType 1 = price
  // INCLUDES VAT (0 = VAT added on top, 2 = exempt). Omitted → Morning builds one
  // row from description + amount.
  income?: MorningIncomeItem[];
  remarks?: string;              // shown on the issued document
  custom?: string;               // echoed back to success/failure/notify URLs
  group?: number;                // payment method (100 card, 120 Bit…) — Grow plugin only
  successUrl?: string;
  failureUrl?: string;
  notifyUrl?: string;
}

export interface CreatePaymentFormResponse {
  success: boolean;
  errorCode: number;
  errorDescription?: string;
  url: string;                   // hosted checkout URL — give this to the customer
}

// Default plugin: the active "מסוף סליקת אשראי" on the HaiTech Morning account.
// Discovered via GET /api/v1/plugins; can be overridden per-call or via env.
const DEFAULT_PLUGIN_ID = '05873f9d-7030-4b66-ad02-338edadee6fc';

export async function createPaymentForm(input: CreatePaymentFormInput): Promise<CreatePaymentFormResponse> {
  const pluginId = input.pluginId || process.env.MORNING_PAYMENT_PLUGIN_ID || DEFAULT_PLUGIN_ID;
  if (!pluginId) {
    throw new Error('MORNING_PAYMENT_PLUGIN_ID is not configured (and no pluginId provided)');
  }

  // When client.id is set, send only { id } — Morning rejects mixed payloads where
  // both id and free-text identity fields are present. Otherwise default `add: true`
  // so the inline client is also written to Morning's client directory (matches the
  // hosted form's "הוספה ללקוחות" toggle).
  const clientPayload: any = input.client.id
    ? { id: input.client.id }
    : { ...input.client, add: input.client.add ?? true };

  const body: any = {
    description: input.description,
    type: input.type ?? DOCUMENT_TYPES.RECEIPT,
    lang: input.lang ?? 'he',
    currency: input.currency ?? 'ILS',
    vatType: input.vatType ?? 0,
    amount: input.amount,
    maxPayments: input.maxPayments ?? 1,
    pluginId,
    client: clientPayload,
  };
  if (input.income?.length) body.income = input.income;
  if (input.remarks) body.remarks = input.remarks;
  if (input.custom) body.custom = input.custom;
  if (input.group) body.group = input.group;
  if (input.successUrl) body.successUrl = input.successUrl;
  if (input.failureUrl) body.failureUrl = input.failureUrl;
  if (input.notifyUrl) body.notifyUrl = input.notifyUrl;

  return morningRequest<CreatePaymentFormResponse>('POST', '/api/v1/payments/form', body);
}
