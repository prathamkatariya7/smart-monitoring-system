import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 5.1: person linked to a process, with role PLANNED_OPERATOR or exactly-one-active OWNER. */
@Entity('process_assignment')
export class ProcessAssignment {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'process_id' })
  processId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  role: 'PLANNED_OPERATOR' | 'OWNER';

  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'RELEASED';

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
