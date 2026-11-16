import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 13.1: append-only, hash-chained. hash/prev_hash are computed by a DB trigger. */
@Entity('audit_record')
export class AuditRecord {
  @PrimaryColumn('uuid', { name: 'audit_id' })
  auditId: string;

  @Column({ name: 'ts_utc', type: 'timestamptz' })
  tsUtc: Date;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'user_role', type: 'text', nullable: true })
  userRole: string | null;

  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column()
  action: string;

  @Column({ name: 'entity_type' })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({ name: 'previous_value_json', type: 'jsonb', nullable: true })
  previousValueJson: unknown | null;

  @Column({ name: 'new_value_json', type: 'jsonb', nullable: true })
  newValueJson: unknown | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'process_id', type: 'uuid', nullable: true })
  processId: string | null;

  @Column({ name: 'equipment_id', type: 'uuid', nullable: true })
  equipmentId: string | null;

  @Column({ name: 'config_version', type: 'integer', nullable: true })
  configVersion: number | null;

  @Column({ name: 'prev_hash', type: 'text', nullable: true })
  prevHash: string | null;

  @Column()
  hash: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
