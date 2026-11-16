import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Part 6.6: in-app only, no e-mail. */
@Entity('notification')
export class Notification {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  type: string;

  @Column()
  priority: 'NORMAL' | 'HIGH';

  @Column({ name: 'payload_json', type: 'jsonb', default: {} })
  payloadJson: Record<string, unknown>;

  @Column({ name: 'ref_entity', type: 'text', nullable: true })
  refEntity: string | null;

  @Column({ name: 'ref_id', type: 'uuid', nullable: true })
  refId: string | null;

  @Column({ name: 'laboratory_id', type: 'uuid', nullable: true })
  laboratoryId: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ name: 'seen_at', type: 'timestamptz', nullable: true })
  seenAt: Date | null;

  @Column({ name: 'acted_at', type: 'timestamptz', nullable: true })
  actedAt: Date | null;

  @Column({ name: 'escalated_at', type: 'timestamptz', nullable: true })
  escalatedAt: Date | null;

  @Column({ name: 'escalated_to', type: 'uuid', nullable: true })
  escalatedTo: string | null;
}
