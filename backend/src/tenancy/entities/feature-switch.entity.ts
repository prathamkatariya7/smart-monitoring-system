import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 3.6: switches on/off by edition + licence; audited. */
@Entity('feature_switch')
export class FeatureSwitch {
  @PrimaryColumn()
  key: string;

  @Column()
  value: boolean;

  @Column({ name: 'changed_by', type: 'uuid', nullable: true })
  changedBy: string | null;

  @Column({ name: 'changed_at', type: 'timestamptz' })
  changedAt: Date;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
