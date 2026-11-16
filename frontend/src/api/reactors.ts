import { apiClient } from './client';
import type { Equipment, Measurement } from './types';

export const reactorsApi = {
  list: () => apiClient.get<Equipment[]>('/reactors').then((r) => r.data),
  get: (id: string) => apiClient.get<Equipment>(`/reactors/${id}`).then((r) => r.data),
  create: (body: { laboratoryId: string; reactorNumber: string; displayName?: string; profileId?: string }) =>
    apiClient.post<Equipment>('/reactors', body).then((r) => r.data),
  setMaintenanceMode: (id: string, maintenanceMode: boolean, reason: string) =>
    apiClient.patch<Equipment>(`/reactors/${id}/maintenance-mode`, { maintenanceMode, reason }).then((r) => r.data),
  decommission: (id: string, reason: string) =>
    apiClient.patch<Equipment>(`/reactors/${id}/decommission`, { reason }).then((r) => r.data),
  live: (id: string) => apiClient.get<Measurement | null>(`/reactors/${id}/live`).then((r) => r.data),
  recent: (id: string, limit = 50) =>
    apiClient.get<Measurement[]>(`/reactors/${id}/measurements`, { params: { limit } }).then((r) => r.data),
};
