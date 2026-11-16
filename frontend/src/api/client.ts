import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/auth.store';

export const apiClient = axios.create({ baseURL: '/api/v1' });

let refreshPromise: Promise<string | null> | null = null;

function decodeJwtPayload(token: string | null): { exp?: number; sub?: string } | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const jsonStr = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function isTokenExpiring(token: string | null): boolean {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.exp) return true;
  // Consider expiring if within 45 seconds of expiry
  return Date.now() >= payload.exp * 1000 - 45000;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return null;
  try {
    const res = await axios.post('/api/v1/auth/refresh', { refreshToken });
    const { accessToken, refreshToken: newRefreshToken } = res.data as {
      accessToken: string;
      refreshToken: string;
    };
    useAuthStore.getState().setTokens(accessToken, newRefreshToken);
    return accessToken;
  } catch {
    useAuthStore.getState().logout();
    return null;
  }
}

apiClient.interceptors.request.use(async (config) => {
  const isAuthEndpoint =
    config.url?.includes('/auth/login') ||
    config.url?.includes('/auth/refresh');

  if (!isAuthEndpoint) {
    let token = useAuthStore.getState().accessToken;
    const refreshToken = useAuthStore.getState().refreshToken;

    // Proactively refresh before sending request if token is expired/expiring
    if (isTokenExpiring(token) && refreshToken) {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => (refreshPromise = null));
      }
      const newToken = await refreshPromise;
      if (newToken) token = newToken;
    }

    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };
    const isAuthEndpoint =
      original?.url?.includes('/auth/login') ||
      original?.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && original && !original._retried && !isAuthEndpoint) {
      original._retried = true;
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => (refreshPromise = null));
      }
      const newToken = await refreshPromise;
      if (newToken) {
        original.headers.set('Authorization', `Bearer ${newToken}`);
        return apiClient(original);
      }
    }
    return Promise.reject(error);
  },
);
