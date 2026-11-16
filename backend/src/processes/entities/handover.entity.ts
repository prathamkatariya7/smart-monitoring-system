import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 5.4: old owner stays responsible until acknowledgement or In-charge override. */
@Entity('handover')
export class Handover {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'attempt_id' })
  attemptId: string;

  @Column({ name: 'from_user' })
  fromUser: string;

  @Column({ name: 'to_user' })
  toUser: string;

  @Column({ name: 'requested_by' })
  requestedBy: string;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt: Date;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  mode: 'ACK' | 'OVERRIDE' | null;

  @Column()
  reason: string;

  @Column({ name: 'process_state', type: 'text', nullable: true })
  processState: string | null;

  @Column({ name: 'remaining_s', type: 'integer', nullable: true })
  remainingS: number | null;

  @Column({ name: 'snapshot_json', type: 'jsonb', nullable: true })
  snapshotJson: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
