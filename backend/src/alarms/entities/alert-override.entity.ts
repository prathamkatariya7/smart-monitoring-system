import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 6.5: full override record, never edited except end/seen fields. */
@Entity('alert_override')
export class AlertOverride {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'alarm_id' })
  alarmId: string;

  @Column({ name: 'equipment_id' })
  equipmentId: string;

  @Column({ name: 'laboratory_id' })
  laboratoryId: string;

  @Column({ name: 'attempt_id', type: 'uuid', nullable: true })
  attemptId: string | null;

  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  source: 'DEVICE' | 'WEB';

  @Column({ name: 'alert_type' })
  alertType: string;

  @Column()
  severity: string;

  @Column({ type: 'text', nullable: true })
  parameter: string | null;

  @Column({ name: 'value_at_override', type: 'real', nullable: true })
  valueAtOverride: number | null;

  @Column({ name: 'limit_value', type: 'real', nullable: true })
  limitValue: number | null;

  @Column({ name: 'threshold_version_id', type: 'uuid', nullable: true })
  thresholdVersionId: string | null;

  @Column({ name: 'device_ts', type: 'timestamptz', nullable: true })
  deviceTs: Date | null;

  @Column({ name: 'server_ts', type: 'timestamptz' })
  serverTs: Date;

  @Column({ name: 'reason_code' })
  reasonCode: string;

  @Column({ name: 'reason_text', type: 'text', nullable: true })
  reasonText: string | null;

  @Column({ name: 'planned_expiry', type: 'timestamptz' })
  plannedExpiry: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ name: 'end_cause', type: 'text', nullable: true })
  endCause: 'CLEARED' | 'EXPIRED' | 'REVOKED' | 'ATTEMPT_ENDED' | 'ESCALATED' | null;

  @Column({ name: 'seen_by', type: 'uuid', nullable: true })
  seenBy: string | null;

  @Column({ name: 'seen_at', type: 'timestamptz', nullable: true })
  seenAt: Date | null;

  @Column({ name: 'offline_origin', default: false })
  offlineOrigin: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
