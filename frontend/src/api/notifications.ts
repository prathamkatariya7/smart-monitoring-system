import { apiClient } from './client';
import type { Notification } from './types';

export const notificationsApi = {
  /** Active (unseen) feed — what powers the bell badge. */
  list: () => apiClient.get<Notification[]>('/notifications').then((r) => r.data),
  /** Full history including already-seen notifications. */
  history: () => apiClient.get<Notification[]>('/notifications/history').then((r) => r.data),
  markSeen: (id: string) => apiClient.post(`/notifications/${id}/seen`).then((r) => r.data),
  markAllSeen: () => apiClient.post('/notifications/seen-all').then((r) => r.data),
};
