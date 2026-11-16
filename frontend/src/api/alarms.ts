import { apiClient } from './client';
import type { Alarm, AlertCatalog, AlertOverride } from './types';

export const alarmsApi = {
  listAll: () => apiClient.get<Alarm[]>('/alarms').then((r) => r.data),
  listForReactor: (equipmentId: string) => apiClient.get<Alarm[]>(`/reactors/${equipmentId}/alarms`).then((r) => r.data),
  ack: (id: string) => apiClient.post<Alarm>(`/alarms/${id}/ack`).then((r) => r.data),
  override: (id: string, body: { reasonCode: string; reasonText?: string; durationMin: number }) =>
    apiClient.post<AlertOverride>(`/alarms/${id}/override`, body).then((r) => r.data),
  revokeOverride: (id: string, reason: string) => apiClient.post(`/overrides/${id}/revoke`, { reason }).then((r) => r.data),
  markOverrideSeen: (id: string) => apiClient.post(`/overrides/${id}/seen`).then((r) => r.data),
  listOverrides: (equipmentId?: string) =>
    apiClient.get<AlertOverride[]>('/overrides', { params: equipmentId ? { equipmentId } : undefined }).then((r) => r.data),
  alertCatalog: () => apiClient.get<AlertCatalog[]>('/settings/alert-catalog').then((r) => r.data),
  updateAlertCatalog: (
    alertType: string,
    body: { reason: string; class?: string; overridableBy?: string; maxOverrideMin?: number },
  ) => apiClient.post<AlertCatalog>(`/settings/alert-catalog/${alertType}`, body).then((r) => r.data),
};
