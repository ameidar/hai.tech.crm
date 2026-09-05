import { describe, expect, it } from 'vitest';
import {
  buildMorningTokenRequestBody,
  normalizeMorningBaseUrl,
} from '../morning/client.js';

describe('Morning API client helpers', () => {
  it('uses the new client credentials token body', () => {
    expect(buildMorningTokenRequestBody('api-id', 'api-secret')).toEqual({
      id: 'api-id',
      secret: 'api-secret',
      grant_type: 'client_credentials',
    });
  });

  it('normalizes Morning API base URL variants to the new host origin', () => {
    expect(normalizeMorningBaseUrl('http://www.greeninvoice.co.il/api')).toBe('https://api.greeninvoice.co.il');
    expect(normalizeMorningBaseUrl('https://www.greeninvoice.co.il/api/')).toBe('https://api.greeninvoice.co.il');
    expect(normalizeMorningBaseUrl('https://api.greeninvoice.co.il/api')).toBe('https://api.greeninvoice.co.il');
    expect(normalizeMorningBaseUrl('https://api.greeninvoice.co.il/')).toBe('https://api.greeninvoice.co.il');
  });
});
