import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('ownership_history')
export class OwnershipHistory {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'attempt_id' })
  attemptId: string;

  @Column({ name: 'owner_user_id' })
  ownerUserId: string;

  @Column({ name: 'from_ts', type: 'timestamptz' })
  fromTs: Date;

  @Column({ name: 'to_ts', type: 'timestamptz', nullable: true })
  toTs: Date | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'handover_id', type: 'uuid', nullable: true })
  handoverId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
