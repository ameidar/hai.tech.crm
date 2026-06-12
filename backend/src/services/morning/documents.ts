import { morningRequest } from './client.js';

// Morning document types — see https://greeninvoice.docs.apiary.io/
export const DOCUMENT_TYPES = {
  PRICE_QUOTE: 10,        // הצעת מחיר
  WORK_ORDER: 100,        // הזמנת עבודה
  DELIVERY_NOTE: 200,     // תעודת משלוח
  PROFORMA: 300,          // חשבון עסקה (Proforma)
  TAX_INVOICE: 305,       // חשבונית מס (binding)
  TAX_INVOICE_RECEIPT: 320, // חשבונית מס + קבלה
  RECEIPT: 400,           // קבלה
  CREDIT_INVOICE: 330,    // חשבונית זיכוי
} as const;

// Morning vatType (verified empirically against the drafts endpoint):
//   0 = default — price excludes VAT, Morning adds 18% on top (this is the regular case)
//   1 = exempt — no VAT (e.g. עוסק פטור)
//   2 = included — price already includes VAT, Morning extracts it (line total = price × qty)
// IMPORTANT: VAT handling is controlled by the PER-LINE vatType on each income item, not the
// document-level vatType. A document-level vatType:2 with no per-line vatType still adds 18%
// on top — only a per-line vatType:2 makes Morning treat that line's price as VAT-inclusive.
export type VatType = 0 | 1 | 2;

// Morning payment-line types (for receipt documents like 320/400). Values verified
// against Green Invoice's published PaymentType enum.
export const PAYMENT_TYPES = {
  DEDUCTION_AT_SOURCE: 0, // ניכוי מס במקור
  CASH: 1,                // מזומן
  CHEQUE: 2,              // צ׳ק
  CREDIT_CARD: 3,         // כרטיס אשראי
  BANK_TRANSFER: 4,       // העברה בנקאית
  PAYPAL: 5,              // PayPal
  PAYMENT_APP: 10,        // אפליקציית תשלום (ביט / פייבוקס)
} as const;

export interface MorningPaymentItem {
  date: string;           // ISO date YYYY-MM-DD
  type: number;           // see PAYMENT_TYPES
  price: number;          // gross amount actually received
  currency?: string;
  // Cheque-specific details (type === PAYMENT_TYPES.CHEQUE). Morning's API uses British
  // spelling `chequeNum`. All optional strings; bankName is recommended for cheques.
  chequeNum?: string;     // מספר צ׳ק
  bankName?: string;      // שם הבנק (Hebrew or English)
  bankBranch?: string;    // מספר סניף
  bankAccount?: string;   // מספר חשבון
}

export interface MorningClient {
  id?: string;              // existing Morning client UUID — when set, Morning links the
                            // new document to this client instead of creating/upserting,
                            // and the rest of the fields below can be omitted.
  name?: string;            // required when `id` is not set
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
  date?: string;            // ISO date (YYYY-MM-DD) — sets the document date. Omitted → Morning uses today.
                            // Backdating is allowed only within Morning's account window (a few days / current tax period).
  dueDate?: string;         // ISO date — for proforma/quote
  payment?: MorningPaymentItem[]; // receipt lines — required for receipt docs (320/400)
  linkedDocumentIds?: string[];   // related Morning doc ids — e.g. a 400 receipt linked to its 305 tax
                                  // invoice; Morning closes the linked invoice when fully receipted.
}

export interface MorningDocument {
  id: string;
  number: number;
  type: number;
  documentDate: string;
  status: number;
  amount?: number;          // document gross total (incl. VAT)
  amountOpened?: number;    // open/unpaid balance — 0 means fully receipted
  url?: { he?: string; en?: string; origin?: string };
  client?: MorningClient;
  income?: MorningIncomeItem[];
  payment?: MorningPaymentItem[]; // receipt lines present on receipt docs (320/400)
}

/** Fetch a single Morning document by its API id (UUID). */
export async function getMorningDocument(id: string): Promise<MorningDocument> {
  return morningRequest<MorningDocument>('GET', `/api/v1/documents/${encodeURIComponent(id)}`);
}

/**
 * Close an open Morning document — sets its status to "Closed". Used to close a proforma
 * (חשבון עסקה, 300) once a binding tax invoice has been issued from it, so it is no longer
 * counted as open. Idempotent from the caller's view: Morning rejects closing an already
 * closed/cancelled document, so callers should treat failures as best-effort.
 */
export async function closeMorningDocument(id: string): Promise<void> {
  await morningRequest('POST', `/api/v1/documents/${encodeURIComponent(id)}/close`, {});
}

/** Search Morning documents (e.g. by document number) — returns the matching items. */
export async function searchMorningDocuments(
  query: { type?: number[]; number?: number; page?: number; pageSize?: number },
): Promise<{ items: MorningDocument[]; total: number }> {
  const body = { page: 1, pageSize: 25, ...query };
  return morningRequest<{ items: MorningDocument[]; total: number }>('POST', '/api/v1/documents/search', body);
}

export async function createDocument(input: CreateDocumentInput): Promise<MorningDocument> {
  const body = {
    lang: 'he',
    currency: 'ILS',
    vatType: 0,
    ...input,
  };
  return morningRequest<MorningDocument>('POST', '/api/v1/documents', body);
}

/**
 * Render the same document via Morning's preview endpoint — returns the rendered
 * PDF as a base64 string in `file`, with NO record created in Morning's books and
 * NO document number allocated. Use for end-to-end testing without leaving traces.
 */
export interface PreviewResponse {
  file: string;            // base64-encoded PDF
}

export async function previewDocument(input: CreateDocumentInput): Promise<PreviewResponse> {
  const body = {
    lang: 'he',
    currency: 'ILS',
    vatType: 0,
    ...input,
  };
  return morningRequest<PreviewResponse>('POST', '/api/v1/documents/preview', body);
}

/**
 * Create a Morning **draft** — sits in Morning's drafts area without a document number,
 * editable from the UI. The user finalizes (and can backdate) from Morning's UI; our
 * regular `createDocument` call goes straight to a numbered, signed, immutable document
 * and is constrained by Morning's API-side date validation.
 */
export interface CreateDraftResponse {
  id: string;
  creationDate: number;
  lastUpdateDate: number;
  doc: CreateDocumentInput & { amount?: number };
}

export async function createDraftDocument(input: CreateDocumentInput): Promise<CreateDraftResponse> {
  const body = { lang: 'he', currency: 'ILS', vatType: 0, ...input };
  return morningRequest<CreateDraftResponse>('POST', '/api/v1/documents/drafts', body);
}

export async function deleteDraftDocument(draftId: string): Promise<void> {
  await morningRequest('DELETE', `/api/v1/documents/drafts/${draftId}`);
}
