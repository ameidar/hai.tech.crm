import { describe, expect, it } from 'vitest';
import {
  buildMorningTokenRequestBody,
  normalizeMorningBaseUrl,
  parseMorningTokenResponse,
} from '../morning/client.js';

describe('Morning API client helpers', () => {
  it('uses the OAuth2 client credentials token body for the Morning IDP', () => {
    expect(buildMorningTokenRequestBody('api-id', 'api-secret')).toEqual({
      grant_type: 'client_credentials',
      client_id: 'api-id',
      client_secret: 'api-secret',
    });
  });

  it('parses the IDP token response (accessToken + expiresAt seconds)', () => {
    expect(parseMorningTokenResponse({ accessToken: 'tok', expiresAt: 1792331947 })).toEqual({
      token: 'tok',
      expiresAt: 1792331947000,
    });
    expect(parseMorningTokenResponse({ access_token: 'tok2', expires_in: 3600 }, 1000)).toEqual({
      token: 'tok2',
      expiresAt: 3601000,
    });
    expect(() => parseMorningTokenResponse({})).toThrow(/token missing/);
  });

  it('normalizes Morning API base URL variants to the new host origin', () => {
    expect(normalizeMorningBaseUrl('http://www.greeninvoice.co.il/api')).toBe('https://api.greeninvoice.co.il');
    expect(normalizeMorningBaseUrl('https://www.greeninvoice.co.il/api/')).toBe('https://api.greeninvoice.co.il');
    expect(normalizeMorningBaseUrl('https://api.greeninvoice.co.il/api')).toBe('https://api.greeninvoice.co.il');
    expect(normalizeMorningBaseUrl('https://api.greeninvoice.co.il/')).toBe('https://api.greeninvoice.co.il');
  });
});
