import { apiClient } from './client';
import type { CalibrationVersion } from './types';

export interface CreateCalibrationBody {
  deviceId: string;
  equipmentId: string;
  channel: string;
  method: 'single_point' | 'two_point' | 'multi_point';
  points: Array<{ reference: number; indicated: number }>;
  referenceInstrument?: string;
  certificateNo?: string;
  certificateFileRef?: string;
  calibratedOn?: string;
  dueOn?: string;
  reason: string;
}

export const calibrationsApi = {
  list: (deviceId?: string) =>
    apiClient.get<CalibrationVersion[]>('/calibrations', { params: deviceId ? { deviceId } : undefined }).then((r) => r.data),
  due: (withinDays = 30) =>
    apiClient.get<CalibrationVersion[]>('/calibrations/due', { params: { withinDays } }).then((r) => r.data),
  get: (id: string) => apiClient.get<CalibrationVersion>(`/calibrations/${id}`).then((r) => r.data),
  create: (body: CreateCalibrationBody) => apiClient.post<CalibrationVersion>('/calibrations', body).then((r) => r.data),
  approve: (id: string) => apiClient.post<CalibrationVersion>(`/calibrations/${id}/approve`).then((r) => r.data),
  apply: (id: string) => apiClient.post<CalibrationVersion>(`/calibrations/${id}/apply`).then((r) => r.data),
  rollback: (id: string, reason: string) =>
    apiClient.post<CalibrationVersion>(`/calibrations/${id}/rollback`, { reason }).then((r) => r.data),
};
