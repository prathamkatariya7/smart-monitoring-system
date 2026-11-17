import { apiClient } from './client';
import type { AuthUser, Role } from './types';

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

export interface UserSummary {
  id: string;
  name: string;
  username: string;
  roles: Role[];
  laboratoryId: string | null;
  laboratoryName: string | null;
  reportsToUserId: string | null;
  reportsToName: string | null;
}

export const authApi = {
  login: (username: string, password: string, mfaCode?: string) =>
    apiClient.post<LoginResponse>('/auth/login', { username, password, mfaCode }).then((r) => r.data),
  me: () => apiClient.get<AuthUser>('/auth/me').then((r) => r.data),
  users: () => apiClient.get<UserSummary[]>('/auth/users').then((r) => r.data),
  createUser: (body: {
    name: string;
    username: string;
    password: string;
    roles: Role[];
    laboratoryId?: string;
    reportsToUserId?: string;
  }) => apiClient.post<UserSummary>('/auth/users', body).then((r) => r.data),
  resetPassword: (userId: string, newPassword: string) =>
    apiClient.post(`/auth/users/${userId}/reset-password`, { newPassword }).then((r) => r.data),
  reassignLab: (userId: string, laboratoryId: string, reportsToUserId?: string) =>
    apiClient.patch(`/auth/users/${userId}/lab`, { laboratoryId, reportsToUserId }).then((r) => r.data),
  logout: () => apiClient.post('/auth/logout').then((r) => r.data),
  enrollMfa: () => apiClient.post<{ secret: string; uri: string }>('/auth/mfa/enroll').then((r) => r.data),
  confirmMfa: (code: string) => apiClient.post('/auth/mfa/confirm', { code }).then((r) => r.data),
};
