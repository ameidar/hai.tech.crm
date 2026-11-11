import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    morning: {
      baseUrl: 'https://api.greeninvoice.co.il',
      tokenUrl: 'https://idp.example/oauth/token',
      apiKeyId: 'kid',
      apiSecret: 'secret',
    },
  },
}));

import { MORNING_EXPENSE_UPLOAD_URL, sha256, uploadExpenseFileToMorning } from '../morning/expense-upload.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
let uploadStatus = 204;

beforeEach(() => {
  uploadStatus = 204;
  fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === 'https://idp.example/oauth/token') return json({ accessToken: 'tok-1', expires_in: 3600 });
    if (url === MORNING_EXPENSE_UPLOAD_URL) return json({ url: 'https://s3.example/upload', fields: { key: 'expense/abc', policy: 'p0l', 'x-amz-signature': 'sig' } });
    if (url === 'https://s3.example/upload') return new Response(uploadStatus === 204 ? null : 'AccessDenied', { status: uploadStatus });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('uploadExpenseFileToMorning', () => {
  it('gets a token, presigns with the bearer token and posts fields then the file (204 = ok)', async () => {
    await uploadExpenseFileToMorning(Buffer.from('%PDF-1.4 test'), 'חשבונית.pdf', 'application/pdf');

    const presign = fetchMock.mock.calls.find(([u]) => u === MORNING_EXPENSE_UPLOAD_URL)!;
    expect(presign[1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer tok-1' } });
    expect(MORNING_EXPENSE_UPLOAD_URL).toBe('https://apigw.greeninvoice.co.il/file-upload/v1/url?context=expense&data=%7B%22source%22%3A5%7D');

    const upload = fetchMock.mock.calls.find(([u]) => u === 'https://s3.example/upload')!;
    expect(upload[1]!.method).toBe('POST');
    const form = upload[1]!.body as FormData;
    expect([...form.keys()]).toEqual(['key', 'policy', 'x-amz-signature', 'file']);
    expect(form.get('key')).toBe('expense/abc');
    const file = form.get('file') as File;
    expect(file.name).toBe('חשבונית.pdf');
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe('%PDF-1.4 test');
  });

  it('throws when the upload does not return 204', async () => {
    uploadStatus = 403;
    await expect(uploadExpenseFileToMorning(Buffer.from('x'), 'a.png', 'image/png')).rejects.toThrow(/HTTP 403 AccessDenied/);
  });

  it('throws when presign fails or has no url', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === MORNING_EXPENSE_UPLOAD_URL ? json({ errorMessage: 'nope' }, 401) : json({ accessToken: 'tok-1', expires_in: 3600 }));
    await expect(uploadExpenseFileToMorning(Buffer.from('x'), 'a.pdf', 'application/pdf')).rejects.toThrow(/upload URL failed: HTTP 401/);
    fetchMock.mockImplementation(async (url: string) =>
      url === MORNING_EXPENSE_UPLOAD_URL ? json({ fields: {} }) : json({ accessToken: 'tok-1', expires_in: 3600 }));
    await expect(uploadExpenseFileToMorning(Buffer.from('x'), 'a.pdf', 'application/pdf')).rejects.toThrow(/missing/);
  });

  it('hashes content with sha256', () => {
    expect(sha256(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
