// Mirrors the backend's actual entities/DTOs (backend/src/**). Hand-written,
// no OpenAPI spec exists server-side to generate from. Keep in sync manually
// when backend shapes change.

export type Role = 'ADMIN' | 'SUPPORT' | 'LAB_INCHARGE' | 'ANALYST' | 'AUDITOR' | 'BOROSIL_ADMIN';

export interface AuthUser {
  userId: string;
  username: string;
  name: string;
  roles: Role[];
  isAdmin: boolean;
  laboratoryIds: string[];
}

export interface Site {
  id: string;
  clientId: string;
  name: string;
  timeZone: string;
  createdAt: string;
}

export interface Laboratory {
  id: string;
  siteId: string;
  name: string;
  code?: string | null;
  createdAt: string;
}

export interface Client {
  id: string;
  name: string;
  edition: 'solo' | 'team' | 'enterprise';
  policyPack: 'flexible' | 'standard' | 'regulated';
  terminologyJson: Record<string, string>;
  status: string;
  createdAt: string;
}

export interface FeatureSwitch {
  key: string;
  value: boolean;
  changedBy?: string | null;
  changedAt: string;
  reason?: string | null;
  createdAt: string;
}

export interface Equipment {
  id: string;
  laboratoryId: string;
  equipmentType: string;
  reactorNumber: string;
  displayName?: string | null;
  profileId?: string | null;
  maintenanceMode: boolean;
  status: 'ACTIVE' | 'DECOMMISSIONED';
  online?: boolean;
  boundDeviceId?: string | null;
  createdAt: string;
}

export interface Device {
  id: string;
  serialNo: string;
  hwRevision?: string | null;
  certSerial?: string | null;
  claimCode?: string | null;
  claimState: 'UNBOUND' | 'CLAIMED';
  status: 'UNBOUND' | 'ACTIVE' | 'DECOMMISSIONED';
  fwP4?: string | null;
  fwC6?: string | null;
  dwinProjectVer?: string | null;
  lastSeen?: string | null;
  clockSource?: string | null;
  lastNtpSync?: string | null;
  createdAt: string;
  /** Real connectivity (90s MQTT heartbeat timeout) -- distinct from `status`
   * above, which is the claim lifecycle and stays ACTIVE forever once claimed. */
  online: boolean;
  lastTelemetryAt?: string | null;
  currentBinding?: {
    bindingId: string;
    equipmentId: string;
    reactorNumber?: string;
    displayName?: string;
  } | null;
}

export interface DeviceBinding {
  id: string;
  deviceId: string;
  equipmentId: string;
  laboratoryId: string;
  boundFrom: string;
  boundTo?: string | null;
  boundBy: string;
  reason?: string | null;
  replacesBindingId?: string | null;
  createdAt: string;
}

export interface Measurement {
  ts: string;
  receivedAt: string;
  deviceId: string;
  equipmentId: string;
  laboratoryId: string;
  processId?: string | null;
  attemptId?: string | null;
  bootId: number;
  seq: number;
  monoMs?: string | null;
  tsOriginal?: string | null;
  temperatureC?: number | null;
  temperatureRawC?: number | null;
  rpm?: number | null;
  torqueNcm?: number | null;
  quality?: number | null;
  faultCode?: number | null;
  flags: number;
  calibrationVersion?: number | null;
  fwVersion?: string | null;
  batchId?: string | null;
}

export interface DataGap {
  id: string;
  deviceId: string;
  attemptId?: string | null;
  fromTs: string;
  toTs: string;
  expectedN?: number | null;
  kind: 'BUFFER_OVERWRITE' | 'OUTAGE' | 'MISSING_SEQ';
  detectedAt: string;
}

export type ProcessStatus =
  | 'SCHEDULED'
  | 'ACCEPTED'
  | 'RUNNING'
  | 'PAUSED'
  | 'AWAITING_COMPLETION'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ABORTED';

export interface ProcessAssignmentItem {
  userId: string;
  role: string;
  status: string;
  userName: string;
}

export interface Process {
  id: string;
  equipmentId: string;
  laboratoryId: string;
  name: string;
  description?: string | null;
  plannedStartUtc: string;
  plannedDurationS: number;
  durationUnitDisplay: string;
  plannedEndUtc: string;
  status: ProcessStatus;
  quickRun: boolean;
  createdBy: string;
  remarks?: string | null;
  createdAt: string;
  ownerAnalystName?: string | null;
  ownerStatus?: string | null;
  assignments?: ProcessAssignmentItem[];
}

export interface ProcessAttempt {
  id: string;
  processId: string;
  attemptNo: number;
  previousAttemptId?: string | null;
  startTs?: string | null;
  endTs?: string | null;
  plannedEndTs?: string | null;
  activeElapsedS: number;
  endReason?: string | null;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'AWAITING_COMPLETION' | 'COMPLETED' | 'ABORTED';
  createdAt: string;
}

export type AlarmSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlarmState = 'ACTIVE_UNACK' | 'ACTIVE_ACK' | 'RETURNED_UNACK' | 'NORMAL';

export interface Alarm {
  id: string;
  attemptId?: string | null;
  equipmentId: string;
  laboratoryId: string;
  parameter: string;
  kind: string;
  severity: AlarmSeverity;
  thresholdVersionId?: string | null;
  onsetTs: string;
  ackBy?: string | null;
  ackTs?: string | null;
  returnTs?: string | null;
  state: AlarmState;
  origin: 'DEVICE' | 'SERVER';
  createdAt: string;
}

export interface AlertCatalog {
  id: string;
  version: number;
  alertType: string;
  class: AlarmSeverity;
  overridableBy: 'NONE' | 'OWNER' | 'INCHARGE';
  maxOverrideMin: number;
  soundPattern?: string | null;
  changedBy?: string | null;
  reason?: string | null;
  createdAt: string;
}

export interface AlertOverride {
  id: string;
  alarmId: string;
  equipmentId: string;
  laboratoryId: string;
  attemptId?: string | null;
  deviceId?: string | null;
  userId: string;
  source: 'DEVICE' | 'WEB';
  alertType: string;
  severity: AlarmSeverity;
  parameter?: string | null;
  valueAtOverride?: number | null;
  limitValue?: number | null;
  thresholdVersionId?: string | null;
  deviceTs?: string | null;
  serverTs: string;
  reasonCode: string;
  reasonText?: string | null;
  plannedExpiry: string;
  endedAt?: string | null;
  endCause?: 'CLEARED' | 'EXPIRED' | 'REVOKED' | 'ATTEMPT_ENDED' | 'ESCALATED' | null;
  seenBy?: string | null;
  seenAt?: string | null;
  offlineOrigin: boolean;
  createdAt: string;
}

export interface CalibrationVersion {
  id: string;
  deviceId: string;
  equipmentId: string;
  channel: string;
  method: 'single_point' | 'two_point' | 'multi_point';
  pointsJson: Array<{ reference: number; indicated: number }>;
  coefficientsJson: { a: number; b: number };
  previousVersionId?: string | null;
  errorSummary?: unknown;
  referenceInstrument?: string | null;
  certificateNo?: string | null;
  certificateFileRef?: string | null;
  calibratedOn?: string | null;
  dueOn?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  status: 'DRAFT' | 'APPROVED' | 'APPLIED' | 'SUPERSEDED' | 'ROLLED_BACK';
  enteredBy: string;
  approvedBy?: string | null;
  reason?: string | null;
  deviceAckTs?: string | null;
  configVersion?: number | null;
  createdAt: string;
}

export type MaintenanceKind =
  | 'PREVENTIVE'
  | 'CORRECTIVE'
  | 'SENSOR_REPLACEMENT'
  | 'DEVICE_REPLACEMENT'
  | 'COMMS_FAULT'
  | 'EQUIPMENT_FAULT'
  | 'FIRMWARE_SERVICE';

export interface MaintenanceRecord {
  id: string;
  equipmentId: string;
  kind: MaintenanceKind;
  performedOn: string;
  performedBy: string;
  remarks?: string | null;
  nextDueOn?: string | null;
  linkedDeviceBindingId?: string | null;
  downtimeStart?: string | null;
  downtimeEnd?: string | null;
  createdAt: string;
}

export interface ExportJob {
  id: string;
  requestedBy: string;
  scopeJson: { equipmentId: string; from: string; to: string; intervalS?: number };
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  fileRef?: string | null;
  sha256?: string | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  priority: 'NORMAL' | 'HIGH';
  payloadJson: Record<string, unknown>;
  refEntity?: string | null;
  refId?: string | null;
  laboratoryId?: string | null;
  createdAt: string;
  deliveredAt?: string | null;
  seenAt?: string | null;
  actedAt?: string | null;
  escalatedAt?: string | null;
  escalatedTo?: string | null;
}

export interface LicenceStatus {
  installed: boolean;
  valid: boolean;
  expired: boolean;
  payload: {
    organisation: string;
    edition: 'solo' | 'team' | 'enterprise';
    maxDevices: number;
    supportTermEnd: string;
    featureFlags: Record<string, boolean>;
    issuedAt: string;
  } | null;
  error?: string;
}

export interface BackupFile {
  file: string;
  sizeBytes: number;
  createdAt: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'critical';
  timestamp: string;
  checks: {
    database: string;
    mqttBroker: string;
    disk: 'unknown' | { freeBytes: number; totalBytes: number; low: boolean };
    backup: { lastBackupAgeMs: number | null; stale: boolean };
    licence: { installed: boolean; valid: boolean; expired: boolean; edition: string | null; maxDevices: number | null };
  };
}
