import { apiClient } from './client';
import type { Device, DeviceBinding } from './types';

export const devicesApi = {
  list: () => apiClient.get<Device[]>('/devices').then((r) => r.data),
  get: (id: string) => apiClient.get<Device>(`/devices/${id}`).then((r) => r.data),
  history: (id: string) => apiClient.get<DeviceBinding[]>(`/devices/${id}/history`).then((r) => r.data),
  claim: (body: { serialNo: string; claimCode: string; hwRevision?: string; certSerial?: string }) =>
    apiClient.post<Device>('/devices/claim', body).then((r) => r.data),
  claimBulk: (csv: string) =>
    apiClient
      .post<{ claimed: Device[]; errors: Array<{ line: number; message: string }> }>('/devices/claim/bulk', { csv })
      .then((r) => r.data),
  bind: (id: string, body: { equipmentId: string; reason: string }) =>
    apiClient.post<DeviceBinding>(`/devices/${id}/bind`, body).then((r) => r.data),
  unbind: (id: string, reason: string) =>
    apiClient.post<{ ok: true }>(`/devices/${id}/unbind`, { reason }).then((r) => r.data),
  replace: (id: string, body: { newDeviceId: string; mapToEquipmentId?: string; reason: string }) =>
    apiClient.post<DeviceBinding>(`/devices/${id}/replace`, body).then((r) => r.data),
  decommission: (id: string, reason: string) =>
    apiClient.post<Device>(`/devices/${id}/decommission`, { reason }).then((r) => r.data),
  reactivate: (id: string, reason?: string) =>
    apiClient.post<Device>(`/devices/${id}/reactivate`, { reason: reason || 'Reactivated by admin' }).then((r) => r.data),
  sendCommand: (id: string, cmd: string, payload: Record<string, unknown>) =>
    apiClient.post<{ commandId: string }>(`/devices/${id}/commands`, { cmd, payload }).then((r) => r.data),
  pushConfig: (id: string) => apiClient.post(`/devices/${id}/cfg/push`).then((r) => r.data),
  gaps: (id: string) => apiClient.get(`/devices/${id}/gaps`).then((r) => r.data),
};
