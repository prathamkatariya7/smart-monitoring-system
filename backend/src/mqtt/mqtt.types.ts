export interface DeviceStatePayload {
  online: boolean;
  link?: 'eth' | 'wifi' | 'none';
  boot?: number;
  fw?: string;
  ts?: number; // device UTC ms if synced
  motor?: MotorIdentityPayload;
}

export interface MotorIdentityPayload {
  detected: boolean;
  manufacturer?: 'HEIDOLPH' | 'IKA' | string;
  model?: string;
  protocol?: 'HEIDOLPH_RS232_9600_8N1' | 'IKA_RS232_9600_7E1' | string;
  serial?: string | null;
}

/** Part 8.2 batch payload: columnar rows keyed by the `f` header array. */
export interface BatchPayload {
  v: number;
  boot: number;
  attempt?: string | null;
  cal?: number;
  fw?: string;
  link?: 'eth' | 'wifi' | 'none';
  tsync: 0 | 1;
  f: string[];
  d: Array<Array<string | number>>;
}

export interface DeviceEventPayload {
  type: string;
  boot?: number;
  ts?: number; // UTC ms, if synced
  mono?: number;
  offline_origin?: boolean;
  [key: string]: unknown;
}

/** Flag bits (Part 8.2 `fl` column), one bit per condition. */
export const FLAG_BITS = {
  LATE_CYCLE: 1 << 0,
  TIME_UNSYNCED: 1 << 1,
  TIME_ESTIMATED: 1 << 2,
  TIME_DERIVED: 1 << 3,
  GAP: 1 << 4,
  POST_PLANNED: 1 << 5,
  STARTED_OFFLINE: 1 << 6,
  LINK_DOWN: 1 << 7,
} as const;
