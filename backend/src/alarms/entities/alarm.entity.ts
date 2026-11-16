import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 6.3: ACTIVE_UNACK -> ACTIVE_ACK -> RETURNED_UNACK -> NORMAL. RLS on laboratory_id. */
@Entity('alarm')
export class Alarm {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'attempt_id', type: 'uuid', nullable: true })
  attemptId: string | null;

  @Column({ name: 'equipment_id' })
  equipmentId: string;

  @Column({ name: 'laboratory_id' })
  laboratoryId: string;

  @Column()
  parameter: string;

  @Column()
  kind: string;

  @Column()
  severity: 'INFO' | 'WARNING' | 'CRITICAL';

  @Column({ name: 'threshold_version_id', type: 'uuid', nullable: true })
  thresholdVersionId: string | null;

  @Column({ name: 'onset_ts', type: 'timestamptz' })
  onsetTs: Date;

  @Column({ name: 'ack_by', type: 'uuid', nullable: true })
  ackBy: string | null;

  @Column({ name: 'ack_ts', type: 'timestamptz', nullable: true })
  ackTs: Date | null;

  @Column({ name: 'return_ts', type: 'timestamptz', nullable: true })
  returnTs: Date | null;

  @Column({ default: 'ACTIVE_UNACK' })
  state: 'ACTIVE_UNACK' | 'ACTIVE_ACK' | 'RETURNED_UNACK' | 'NORMAL';

  @Column()
  origin: 'DEVICE' | 'SERVER';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
