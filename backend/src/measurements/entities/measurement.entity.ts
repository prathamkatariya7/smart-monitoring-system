import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Part 10.3: hypertable. App role has INSERT/SELECT only (no UPDATE/DELETE,
 * enforced at the DB level). Composite PK gives idempotent inserts: a
 * duplicate (device_id, boot_id, seq, ts) from a QoS-1 redelivery is a no-op
 * via ON CONFLICT DO NOTHING in the ingestion service, never a TypeORM save.
 */
@Entity('measurement')
export class Measurement {
  @PrimaryColumn({ type: 'timestamptz' })
  ts: Date;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @PrimaryColumn('uuid', { name: 'device_id' })
  deviceId: string;

  @Column({ name: 'equipment_id', type: 'uuid' })
  equipmentId: string;

  @Column({ name: 'laboratory_id', type: 'uuid' })
  laboratoryId: string;

  @Column({ name: 'process_id', type: 'uuid', nullable: true })
  processId: string | null;

  @Column({ name: 'attempt_id', type: 'uuid', nullable: true })
  attemptId: string | null;

  @PrimaryColumn({ name: 'boot_id', type: 'integer' })
  bootId: number;

  @PrimaryColumn({ type: 'integer' })
  seq: number;

  @Column({ name: 'mono_ms', type: 'bigint', nullable: true })
  monoMs: string | null;

  @Column({ name: 'ts_original', type: 'timestamptz', nullable: true })
  tsOriginal: Date | null;

  @Column({ name: 'temperature_c', type: 'real', nullable: true })
  temperatureC: number | null;

  @Column({ name: 'temperature_raw_c', type: 'real', nullable: true })
  temperatureRawC: number | null;

  @Column({ type: 'real', nullable: true })
  rpm: number | null;

  @Column({ name: 'torque_ncm', type: 'real', nullable: true })
  torqueNcm: number | null;

  @Column({ type: 'smallint', nullable: true })
  quality: number | null;

  @Column({ name: 'fault_code', type: 'smallint', nullable: true })
  faultCode: number | null;

  @Column({ type: 'integer', default: 0 })
  flags: number;

  @Column({ name: 'calibration_version', type: 'integer', nullable: true })
  calibrationVersion: number | null;

  @Column({ name: 'fw_version', type: 'text', nullable: true })
  fwVersion: string | null;

  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId: string | null;
}
