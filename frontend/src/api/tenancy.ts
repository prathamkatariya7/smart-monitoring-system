import { apiClient } from './client';
import type { Client, Site, Laboratory, FeatureSwitch } from './types';

export const tenancyApi = {
  client: () => apiClient.get<Client>('/client').then((r) => r.data),
  setTerminology: (body: Record<string, string>) => apiClient.put('/settings/terminology', body).then((r) => r.data),
  setPolicy: (policyPack: string, reason: string) =>
    apiClient.put('/settings/policy', { policyPack, reason }).then((r) => r.data),
  features: () => apiClient.get<FeatureSwitch[]>('/settings/features').then((r) => r.data),
  setFeature: (key: string, value: boolean, reason: string) =>
    apiClient.put(`/settings/features/${key}`, { value, reason }).then((r) => r.data),
  sites: () => apiClient.get<Site[]>('/sites').then((r) => r.data),
  createSite: (body: { name: string; timeZone?: string }) => apiClient.post<Site>('/sites', body).then((r) => r.data),
  laboratories: () => apiClient.get<Laboratory[]>('/laboratories').then((r) => r.data),
  createLaboratory: (body: { siteId: string; name: string; code?: string }) =>
    apiClient.post<Laboratory>('/laboratories', body).then((r) => r.data),
};
