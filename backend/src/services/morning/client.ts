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

// Morning's 2026 API update retired POST {BASE}/api/v1/account/token (now 404).
// Tokens come from the IDP host as standard OAuth2 client credentials; resource
// calls stay on BASE with the returned bearer token.
export function buildMorningTokenRequestBody(apiKeyId: string, apiSecret: string) {
  return {
    grant_type: 'client_credentials',
    client_id: apiKeyId,
    client_secret: apiSecret,
  };
}

type MorningTokenResponse = {
  accessToken?: string;
  access_token?: string;
  expiresAt?: number; // unix seconds
  expires_in?: number; // seconds from now
};

export function parseMorningTokenResponse(data: MorningTokenResponse, nowMs = Date.now()) {
  const token = data.accessToken ?? data.access_token;
  if (!token) throw new Error('Morning auth failed: token missing in response');
  const expiresAt = data.expiresAt
    ? data.expiresAt * 1000
    : nowMs + (data.expires_in ?? 3500) * 1000;
  return { token, expiresAt };
}

async function fetchToken(): Promise<string> {
  if (!config.morning.apiKeyId || !config.morning.apiSecret) {
    throw new Error('Morning API credentials are not configured');
  }

  const res = await fetch(config.morning.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildMorningTokenRequestBody(config.morning.apiKeyId, config.morning.apiSecret)),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Morning auth failed: ${res.status} ${body}`);
  }

  cachedToken = parseMorningTokenResponse((await res.json()) as MorningTokenResponse);
  return cachedToken.token;
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
