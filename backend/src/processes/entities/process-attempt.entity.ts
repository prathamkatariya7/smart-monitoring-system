import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 5.1: one execution of a process. A restart creates a new attempt; old attempts are never edited. */
@Entity('process_attempt')
export class ProcessAttempt {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'process_id' })
  processId: string;

  @Column({ name: 'attempt_no' })
  attemptNo: number;

  @Column({ name: 'previous_attempt_id', type: 'uuid', nullable: true })
  previousAttemptId: string | null;

  @Column({ name: 'start_ts', type: 'timestamptz', nullable: true })
  startTs: Date | null;

  @Column({ name: 'end_ts', type: 'timestamptz', nullable: true })
  endTs: Date | null;

  @Column({ name: 'planned_end_ts', type: 'timestamptz', nullable: true })
  plannedEndTs: Date | null;

  @Column({ name: 'active_elapsed_s', default: 0 })
  activeElapsedS: number;

  @Column({ name: 'end_reason', type: 'text', nullable: true })
  endReason: string | null;

  @Column({ default: 'PENDING' })
  status:
    | 'PENDING'
    | 'RUNNING'
    | 'PAUSED'
    | 'AWAITING_COMPLETION'
    | 'COMPLETED'
    | 'ABORTED';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
