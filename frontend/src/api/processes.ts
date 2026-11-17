import { apiClient } from './client';
import type { Process, ProcessAttempt } from './types';

export interface CreateProcessBody {
  equipmentId: string;
  name: string;
  description?: string;
  plannedStartUtc: string;
  plannedDurationS: number;
  durationUnitDisplay?: string;
  analystUserIds: string[];
  thresholds?: Record<string, unknown>;
  remarks?: string;
}

export const processesApi = {
  list: () => apiClient.get<Process[]>('/processes').then((r) => r.data),
  get: (id: string) => apiClient.get<Process>(`/processes/${id}`).then((r) => r.data),
  attempts: (id: string) => apiClient.get<ProcessAttempt[]>(`/processes/${id}/attempts`).then((r) => r.data),
  create: (body: CreateProcessBody) => apiClient.post<Process>('/processes', body).then((r) => r.data),
  reschedule: (
    id: string,
    body: { plannedStartUtc?: string; plannedDurationS?: number; equipmentId?: string; reason: string },
  ) => apiClient.post(`/processes/${id}/reschedule`, body).then((r) => r.data),
  acceptAssignment: (id: string, onBehalfOfUserId?: string) =>
    apiClient.post(`/processes/${id}/assign/accept`, { onBehalfOfUserId }).then((r) => r.data),
  rejectAssignment: (id: string, reason: string) =>
    apiClient.post(`/processes/${id}/assign/reject`, { reason }).then((r) => r.data),
  start: (id: string) => apiClient.post(`/processes/${id}/start`).then((r) => r.data),
  pause: (id: string, reason: string) => apiClient.post(`/processes/${id}/pause`, { reason }).then((r) => r.data),
  resume: (id: string) => apiClient.post(`/processes/${id}/resume`).then((r) => r.data),
  complete: (id: string, onBehalf?: boolean) => apiClient.post(`/processes/${id}/complete`, { onBehalf }).then((r) => r.data),
  extend: (id: string, newPlannedDurationS: number, reason: string) =>
    apiClient.post(`/processes/${id}/extend`, { newPlannedDurationS, reason }).then((r) => r.data),
  cancel: (id: string, reason: string) => apiClient.post(`/processes/${id}/cancel`, { reason }).then((r) => r.data),
  abort: (id: string, reason: string) => apiClient.post(`/processes/${id}/abort`, { reason }).then((r) => r.data),
  restart: (id: string, reason: string) => apiClient.post(`/processes/${id}/restart`, { reason }).then((r) => r.data),
  requestHandover: (id: string, toUserId: string, reason: string) =>
    apiClient.post(`/processes/${id}/handover`, { toUserId, reason }).then((r) => r.data),
  ackHandover: (handoverId: string) => apiClient.post(`/handovers/${handoverId}/ack`).then((r) => r.data),
  overrideHandover: (handoverId: string, reason: string) =>
    apiClient.post(`/handovers/${handoverId}/override`, { reason }).then((r) => r.data),
  getThresholds: (id: string) => apiClient.get(`/processes/${id}/thresholds`).then((r) => r.data),
  setThresholds: (id: string, params: Record<string, unknown>, reason: string) =>
    apiClient.post(`/processes/${id}/thresholds`, { params, reason }).then((r) => r.data),
  approveThresholds: (versionId: string) => apiClient.post(`/thresholds/${versionId}/approve`).then((r) => r.data),
  rejectThresholds: (versionId: string, reason: string) =>
    apiClient.post(`/thresholds/${versionId}/reject`, { reason }).then((r) => r.data),
};
