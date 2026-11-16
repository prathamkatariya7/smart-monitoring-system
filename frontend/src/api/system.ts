import axios from 'axios';
import { apiClient } from './client';
import type { LicenceStatus, BackupFile, HealthReport } from './types';

export const systemApi = {
  licence: () => apiClient.get<LicenceStatus>('/system/licence').then((r) => r.data),
  uploadLicence: (body: { payload: Record<string, unknown>; signature: string }) =>
    apiClient.post<LicenceStatus>('/system/licence', body).then((r) => r.data),
  deactivateLicence: () => apiClient.delete<LicenceStatus>('/system/licence').then((r) => r.data),
  backups: () => apiClient.get<BackupFile[]>('/system/backups').then((r) => r.data),
  triggerBackup: () => apiClient.post<BackupFile>('/system/backups').then((r) => r.data),
  backupDownloadUrl: (file: string) => `/api/v1/system/backups/${file}/download`,
  // /health is NOT under /api/v1 and is public -- use the bare axios instance, not apiClient.
  health: () => axios.get<HealthReport>('/health').then((r) => r.data),
};
