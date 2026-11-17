import { apiClient } from './client';
import type { MaintenanceRecord, MaintenanceKind } from './types';

export const maintenanceApi = {
  list: (equipmentId: string) =>
    apiClient.get<MaintenanceRecord[]>('/maintenance', { params: { equipmentId } }).then((r) => r.data),
  due: (withinDays = 30) => apiClient.get<MaintenanceRecord[]>('/maintenance/due', { params: { withinDays } }).then((r) => r.data),
  get: (id: string) => apiClient.get<MaintenanceRecord>(`/maintenance/${id}`).then((r) => r.data),
  create: (body: {
    equipmentId: string;
    kind: MaintenanceKind;
    performedOn: string;
    remarks?: string;
    nextDueOn?: string;
  }) => apiClient.post<MaintenanceRecord>('/maintenance', body).then((r) => r.data),
};
