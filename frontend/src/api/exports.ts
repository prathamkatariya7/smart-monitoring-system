import { apiClient } from './client';
import type { ExportJob } from './types';

export const exportsApi = {
  list: () => apiClient.get<ExportJob[]>('/exports').then((r) => r.data),
  get: (id: string) => apiClient.get<ExportJob>(`/exports/${id}`).then((r) => r.data),
  create: (body: { equipmentId: string; from: string; to: string; intervalS?: number }) =>
    apiClient.post<ExportJob>('/exports', body).then((r) => r.data),
  downloadUrl: (id: string) => `/api/v1/exports/${id}/download`,
};
