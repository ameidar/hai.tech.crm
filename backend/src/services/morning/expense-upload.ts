// Upload an invoice file to Morning as an expense draft. Morning OCRs it and creates the
// draft ~10–30s later (picked up by syncMorningDrafts). Flow mirrors Morning's web app:
//   1. GET a presigned upload target (context=expense, source=5) with the bearer token;
//   2. POST multipart to it — every presign `fields` entry first, then `file`. Success = 204.
import { createHash } from 'crypto';
import { getMorningToken } from './client.js';

export const MORNING_EXPENSE_UPLOAD_URL =
  'https://apigw.greeninvoice.co.il/file-upload/v1/url?context=expense&data=%7B%22source%22%3A5%7D';

export const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

interface PresignResponse {
  url?: string;
  fields?: Record<string, string>;
}

export async function uploadExpenseFileToMorning(buffer: Buffer, fileName: string, mime: string): Promise<void> {
  const token = await getMorningToken();

  const presignRes = await fetch(MORNING_EXPENSE_UPLOAD_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!presignRes.ok) {
    const body = await presignRes.text().catch(() => '');
    throw new Error(`Morning upload URL failed: HTTP ${presignRes.status} ${body.slice(0, 200)}`);
  }
  const presign = (await presignRes.json()) as PresignResponse;
  if (!presign?.url) throw new Error('Morning upload URL missing in response');

  const form = new FormData();
  for (const [key, value] of Object.entries(presign.fields ?? {})) form.append(key, String(value));
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), fileName);

  const uploadRes = await fetch(presign.url, { method: 'POST', body: form });
  if (uploadRes.status !== 204) {
    const body = await uploadRes.text().catch(() => '');
    throw new Error(`Morning file upload failed: HTTP ${uploadRes.status} ${body.slice(0, 200)}`);
  }
}
