import { morningRequest } from './client.js';

// Morning document types — see https://www.greeninvoice.co.il/api-docs
export const DOCUMENT_TYPES = {
  PRICE_QUOTE: 10,
  WORK_ORDER: 100,
  PROFORMA: 200,           // חשבון עסקה
  TAX_INVOICE: 305,
  TAX_INVOICE_RECEIPT: 320,
  RECEIPT: 400,
  CREDIT_INVOICE: 330,
} as const;

// Morning vatType: 0=exempt (no VAT), 1=above (price excludes VAT), 2=included (price includes VAT)
export type VatType = 0 | 1 | 2;

export interface MorningClient {
  name: string;
  taxId?: string;
  emails?: string[];
  phone?: string;
  mobile?: string;
  address?: string;
  city?: string;
  zip?: string;
  country?: string;
  add?: boolean;            // upsert into Morning's client list
}

export interface MorningIncomeItem {
  description: string;
  quantity: number;
  price: number;
  currency?: string;
  vatType?: VatType;
  catalogNum?: string;
}

export interface CreateDocumentInput {
  type: number;
  lang?: 'he' | 'en';
  currency?: string;
  vatType?: VatType;
  client: MorningClient;
  income: MorningIncomeItem[];
  remarks?: string;
  description?: string;
  dueDate?: string;         // ISO date — for proforma/quote
}

export interface MorningDocument {
  id: string;
  number: number;
  type: number;
  documentDate: string;
  status: number;
  url?: { he?: string; en?: string; origin?: string };
  client?: MorningClient;
  income?: MorningIncomeItem[];
}

export async function createDocument(input: CreateDocumentInput): Promise<MorningDocument> {
  const body = {
    lang: 'he',
    currency: 'ILS',
    vatType: 1,
    ...input,
  };
  return morningRequest<MorningDocument>('POST', '/api/v1/documents', body);
}
