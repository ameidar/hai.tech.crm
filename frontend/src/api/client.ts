import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const READ_ONLY_FLAG = 'crmReadOnly';
export const READ_ONLY_MESSAGE = 'משתמש לצפייה בלבד — אין הרשאה לבצע שינויים';

const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const READ_ONLY_ALLOWED = ['/auth/login', '/auth/refresh', '/auth/logout'];

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Read-only (viewer) users: block writes before they reach the server
  const method = (config.method || 'get').toLowerCase();
  if (
    localStorage.getItem(READ_ONLY_FLAG) === '1' &&
    WRITE_METHODS.has(method) &&
    !READ_ONLY_ALLOWED.some((p) => (config.url || '').startsWith(p))
  ) {
    window.alert(READ_ONLY_MESSAGE);
    return Promise.reject(
      Object.assign(new Error(READ_ONLY_MESSAGE), {
        config,
        response: { status: 403, data: { error: READ_ONLY_MESSAGE, code: 'READ_ONLY_USER' } },
      })
    );
  }
  return config;
});

// Response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and we haven't tried to refresh yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refreshToken,
          });

          const { accessToken, refreshToken: newRefreshToken } = response.data;
          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', newRefreshToken);

          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        } catch (refreshError) {
          // Refresh failed, clear tokens and redirect to login
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          window.location.href = '/login';
          return Promise.reject(refreshError);
        }
      }
    }

    return Promise.reject(error);
  }
);

export default api;
