import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Immutable identity observations are coalesced by device + identity. */
@Entity('device_motor_identity')
@Index(
  'device_motor_identity_key_uq',
  ['deviceId', 'manufacturer', 'model', 'protocol', 'serialNo'],
  { unique: true },
)
export class DeviceMotorIdentity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @Column({ type: 'text' })
  manufacturer: string;

  @Column({ type: 'text' })
  model: string;

  @Column({ type: 'text' })
  protocol: string;

  @Column({ name: 'serial_no', type: 'text', default: '' })
  serialNo: string;

  @Column({ name: 'first_seen', type: 'timestamptz' })
  firstSeen: Date;

  @Column({ name: 'last_seen', type: 'timestamptz' })
  lastSeen: Date;

  @Column({ name: 'observation_count', type: 'integer', default: 1 })
  observationCount: number;

  @Column({ name: 'raw_identity', type: 'jsonb', default: {} })
  rawIdentity: Record<string, unknown>;
}
