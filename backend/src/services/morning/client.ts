import { config } from '../../config.js';

export function normalizeMorningBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');

  if (/^https?:\/\/www\.greeninvoice\.co\.il\/api$/i.test(trimmed)) {
    return 'https://api.greeninvoice.co.il';
  }

  if (/^https?:\/\/api\.greeninvoice\.co\.il\/api$/i.test(trimmed)) {
    return trimmed.replace(/\/api$/i, '');
  }

  return trimmed;
}

const BASE = normalizeMorningBaseUrl(config.morning.baseUrl);

let cachedToken: { token: string; expiresAt: number } | null = null;
const TOKEN_BUFFER_SECONDS = 60; // refresh 60s before expiry

export function buildMorningTokenRequestBody(apiKeyId: string, apiSecret: string) {
  return {
    id: apiKeyId,
    secret: apiSecret,
    grant_type: 'client_credentials',
  };
}

async function fetchToken(): Promise<string> {
  if (!config.morning.apiKeyId || !config.morning.apiSecret) {
    throw new Error('Morning API credentials are not configured');
  }

  const res = await fetch(`${BASE}/api/v1/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildMorningTokenRequestBody(config.morning.apiKeyId, config.morning.apiSecret)),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Morning auth failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { token: string; expires?: number };
  // Decode JWT to get exp
  const [, payload] = data.token.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const expiresAt = (decoded.exp ?? Math.floor(Date.now() / 1000) + 3500) * 1000;

  cachedToken = { token: data.token, expiresAt };
  return data.token;
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + TOKEN_BUFFER_SECONDS * 1000) {
    return cachedToken.token;
  }
  return fetchToken();
}

export async function morningRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const msg = parsed?.errorMessage || parsed?.message || text || `HTTP ${res.status}`;
    const err: any = new Error(`Morning ${method} ${path} failed: ${msg}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }

  return parsed as T;
}

export function isMorningConfigured(): boolean {
  return !!(config.morning.apiKeyId && config.morning.apiSecret);
}
