/**
 * TypeScript stub for google-ads-api.
 * This is used ONLY at compile time to avoid TypeScript resolving the package's
 * enormous generated type definitions (~millions of types), which causes tsc to hang.
 * At runtime, Node.js loads the real google-ads-api from node_modules.
 */

export interface GoogleAdsCustomer {
  query(gaql: string): Promise<Record<string, unknown>[]>;
  mutateResources(operations: unknown[]): Promise<unknown>;
}

export interface GoogleAdsApiConfig {
  client_id: string;
  client_secret: string;
  developer_token: string;
}

export interface CustomerConfig {
  customer_id: string;
  refresh_token: string;
  login_customer_id?: string;
}

export class GoogleAdsApi {
  constructor(_config: GoogleAdsApiConfig) {}
  Customer(_config: CustomerConfig): GoogleAdsCustomer {
    return { query: async () => [], mutateResources: async () => ({}) };
  }
}
