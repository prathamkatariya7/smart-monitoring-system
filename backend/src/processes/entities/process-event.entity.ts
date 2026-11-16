import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('process_event')
export class ProcessEvent {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'attempt_id' })
  attemptId: string;

  @Column({ type: 'timestamptz' })
  ts: Date;

  @Column()
  type: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'actor_device_id', type: 'uuid', nullable: true })
  actorDeviceId: string | null;

  @Column({ name: 'detail_json', type: 'jsonb', default: {} })
  detailJson: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
