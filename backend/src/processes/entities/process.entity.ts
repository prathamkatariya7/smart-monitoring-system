import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 5.1: the logical job. RLS on laboratory_id (stamped from equipment at creation). */
@Entity('process')
export class Process {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'equipment_id' })
  equipmentId: string;

  @Column({ name: 'laboratory_id' })
  laboratoryId: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'planned_start_utc', type: 'timestamptz' })
  plannedStartUtc: Date;

  @Column({ name: 'planned_duration_s', type: 'integer' })
  plannedDurationS: number;

  @Column({ name: 'duration_unit_display', default: 'hours' })
  durationUnitDisplay: string;

  @Column({ name: 'planned_end_utc', type: 'timestamptz' })
  plannedEndUtc: Date;

  @Column({
    default: 'SCHEDULED',
  })
  status:
    | 'SCHEDULED'
    | 'ACCEPTED'
    | 'RUNNING'
    | 'PAUSED'
    | 'AWAITING_COMPLETION'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'ABORTED';

  @Column({ name: 'quick_run', default: false })
  quickRun: boolean;

  @Column({ name: 'created_by' })
  createdBy: string;

  @Column({ type: 'text', nullable: true })
  remarks: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
