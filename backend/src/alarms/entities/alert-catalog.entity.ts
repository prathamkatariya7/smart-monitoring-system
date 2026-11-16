import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 6.5: default alert classes, Admin-tunable within policy limits. */
@Entity('alert_catalog')
export class AlertCatalog {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  version: number;

  @Column({ name: 'alert_type' })
  alertType: string;

  @Column()
  class: 'INFO' | 'WARNING' | 'CRITICAL';

  @Column({ name: 'overridable_by', default: 'OWNER' })
  overridableBy: 'NONE' | 'OWNER' | 'INCHARGE';

  @Column({ name: 'max_override_min', default: 60 })
  maxOverrideMin: number;

  @Column({ name: 'sound_pattern', type: 'text', nullable: true })
  soundPattern: string | null;

  @Column({ name: 'changed_by', type: 'uuid', nullable: true })
  changedBy: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
