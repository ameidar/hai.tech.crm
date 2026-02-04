import { APIRequestContext, expect } from '@playwright/test';

const API_BASE = process.env.BASE_URL || 'http://localhost:3001';

export interface ApiClient {
  login(email: string, password: string): Promise<string>;
  getCycles(): Promise<any[]>;
  getCycle(id: string): Promise<any>;
}

export async function createApiClient(request: APIRequestContext): Promise<ApiClient> {
  let authToken: string | null = null;

  return {
    async login(email: string, password: string): Promise<string> {
      const response = await request.post(`${API_BASE}/api/auth/login`, {
        data: { email, password },
      });
      
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      authToken = data.token;
      return authToken;
    },

    async getCycles(): Promise<any[]> {
      const response = await request.get(`${API_BASE}/api/cycles`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      
      expect(response.ok()).toBeTruthy();
      return await response.json();
    },

    async getCycle(id: string): Promise<any> {
      const response = await request.get(`${API_BASE}/api/cycles/${id}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      
      expect(response.ok()).toBeTruthy();
      return await response.json();
    },
  };
}
