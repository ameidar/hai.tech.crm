import { morningRequest } from './client.js';
import { DOCUMENT_TYPES, VatType } from './documents.js';

// Morning payment-form creates a hosted payment link (Meshulam-backed by default).
// Requires a `pluginId` from /api/v1/plugins — typically the active credit-card plugin.
// Default is read from env MORNING_PAYMENT_PLUGIN_ID; if missing the call will 400.

export interface CreatePaymentFormInput {
  description: string;
  amount: number;
  maxPayments?: number;          // 1..36 split-payments
  vatType?: VatType;             // see documents.ts — defaults to 0 (price excludes VAT)
  type?: number;                 // document type Morning issues on success; default 320
  lang?: 'he' | 'en';
  currency?: string;
  pluginId?: string;             // override the env default
  client: {
    name: string;
    emails?: string[];
    phone?: string;
    taxId?: string;
    address?: string;
    city?: string;
  };
  successUrl?: string;
  failureUrl?: string;
  notifyUrl?: string;
}

export interface CreatePaymentFormResponse {
  success: boolean;
  errorCode: number;
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

  const body: any = {
    description: input.description,
    type: input.type ?? DOCUMENT_TYPES.TAX_INVOICE_RECEIPT,
    lang: input.lang ?? 'he',
    currency: input.currency ?? 'ILS',
    vatType: input.vatType ?? 0,
    amount: input.amount,
    maxPayments: input.maxPayments ?? 1,
    pluginId,
    client: input.client,
  };
  if (input.successUrl) body.successUrl = input.successUrl;
  if (input.failureUrl) body.failureUrl = input.failureUrl;
  if (input.notifyUrl) body.notifyUrl = input.notifyUrl;

  return morningRequest<CreatePaymentFormResponse>('POST', '/api/v1/payments/form', body);
}
