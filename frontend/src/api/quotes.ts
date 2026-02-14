import api from './client';

export interface QuoteItem {
  id?: string;
  courseId: string;
  courseName?: string;
  groupsCount: number;
  meetingsPerGroup: number;
  durationMinutes: number;
  pricePerMeeting: number;
  subtotal: number;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  institutionName: string;
  contactName: string;
  contactPhone?: string;
  contactEmail?: string;
  contactRole?: string;
  branchId?: string;
  branch?: { id: string; name: string };
  items: QuoteItem[];
  discount: number;
  totalAmount: number;
  generatedContent?: string;
  notes?: string;
  orderId?: string;
  sentAt?: string;
  acceptedAt?: string;
  rejectedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateQuoteData = {
  institutionName: string;
  contactName: string;
  contactPhone?: string;
  contactEmail?: string;
  contactRole?: string;
  branchId?: string;
  items: Omit<QuoteItem, 'id' | 'courseName' | 'subtotal'>[];
  discount?: number;
  generatedContent?: string;
  notes?: string;
  status?: 'draft' | 'sent';
};

export const quotesApi = {
  list: async (params?: { status?: string; search?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append('status', params.status);
    if (params?.search) searchParams.append('search', params.search);
    const qs = searchParams.toString() ? `?${searchParams.toString()}` : '';
    const res = await api.get<Quote[]>(`/quotes${qs}`);
    // Handle paginated response
    if (res.data && typeof res.data === 'object' && 'data' in res.data) {
      return (res.data as any).data as Quote[];
    }
    return res.data;
  },

  get: async (id: string) => {
    const res = await api.get<Quote>(`/quotes/${id}`);
    return res.data;
  },

  create: async (data: CreateQuoteData) => {
    const res = await api.post<Quote>('/quotes', data);
    return res.data;
  },

  update: async (id: string, data: Partial<CreateQuoteData>) => {
    const res = await api.put<Quote>(`/quotes/${id}`, data);
    return res.data;
  },

  delete: async (id: string) => {
    await api.delete(`/quotes/${id}`);
  },

  send: async (id: string) => {
    const res = await api.post<Quote>(`/quotes/${id}/send`);
    return res.data;
  },

  accept: async (id: string) => {
    const res = await api.post<Quote>(`/quotes/${id}/accept`);
    return res.data;
  },

  reject: async (id: string) => {
    const res = await api.post<Quote>(`/quotes/${id}/reject`);
    return res.data;
  },

  convertToOrder: async (id: string) => {
    const res = await api.post<{ quote: Quote; orderId: string }>(`/quotes/${id}/convert`);
    return res.data;
  },

  generateContent: async (id: string) => {
    const res = await api.post<{ content: string }>(`/quotes/${id}/generate-content`);
    return res.data;
  },

  generateContentPreview: async (data: { institutionName: string; contactName: string; items: any[] }) => {
    const res = await api.post<{ content: string }>('/quotes/generate-content-preview', data);
    return res.data;
  },

  generateVideo: async (id: string) => {
    const res = await api.post<{ status: string; message: string }>(`/quotes/${id}/generate-video`);
    return res.data;
  },

  getVideoStatus: async (id: string) => {
    const res = await api.get(`/quotes/${id}/video`, { responseType: 'blob' });
    return res;
  },
};
